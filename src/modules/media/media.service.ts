import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { OrganizationMembershipRole } from '../organization/entities/organization-membership.entity';
import { PublicMirrorService } from '../public/public-mirror.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { schemaNameFor } from '../tenant/tenant-schema.util';
import { CloudinaryService } from './cloudinary.service';
import { Media } from './entities/media.entity';
import {
  ALLOWED_MIME_TYPES,
  MEDIA_OWNERS,
  MediaOwnerConfig,
  MediaPurposeConfig,
  detectImageMime,
} from './media-purposes';

/** Quién hace la operación. Lo arma el controller con lo que dejó TenantGuard. */
export interface MediaActor {
  userId: string;
  orgId: string;
  role: OrganizationMembershipRole;
}

export interface UploadedFile {
  buffer: Buffer;
  size: number;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly cloudinary: CloudinaryService,
    private readonly publicMirror: PublicMirrorService,
  ) {}

  async listFor(
    ownerType: string,
    ownerId: string,
    actor: MediaActor,
  ): Promise<Media[]> {
    const owner = this.ownerConfig(ownerType);
    await this.assertOwnerExists(owner, ownerType, ownerId, actor);
    const repo = await this.repo();
    return repo.find({
      where: { ownerType, ownerId },
      order: { purpose: 'ASC' },
    });
  }

  async uploadFor(
    ownerType: string,
    ownerId: string,
    purpose: string,
    file: UploadedFile | undefined,
    actor: MediaActor,
  ): Promise<Media> {
    const owner = this.ownerConfig(ownerType);
    const config = this.purposeConfig(owner, ownerType, purpose);
    this.assertCanWrite(owner, actor);
    await this.assertOwnerExists(owner, ownerType, ownerId, actor);
    this.assertValidImage(file, config);

    const uploaded = await this.cloudinary.upload(file!.buffer, {
      folder: this.folderFor(actor.orgId, ownerType, ownerId),
      transformation: config.transformation,
    });

    const repo = await this.repo();
    const existing = await repo.findOneBy({ ownerType, ownerId, purpose });
    const saved = await repo.save(
      repo.create({
        ...(existing ?? {}),
        ownerType,
        ownerId,
        purpose,
        url: uploaded.url,
        publicId: uploaded.publicId,
        format: uploaded.format,
        width: uploaded.width,
        height: uploaded.height,
        bytes: uploaded.bytes,
        createdBy: actor.userId,
      }),
    );

    if (existing) {
      // La imagen nueva ya quedó guardada: si el borrado de la vieja falla,
      // solo queda un archivo huérfano en Cloudinary, no rompe la operación.
      await this.destroyQuietly(existing.publicId);
    }

    if (ownerType === 'organization') {
      await this.publicMirror.setOrganizationImage(ownerId, purpose, saved.url);
    }

    return saved;
  }

  async remove(id: string, actor: MediaActor): Promise<void> {
    const repo = await this.repo();
    const media = await repo.findOneBy({ id });
    if (!media) {
      throw new NotFoundException('La imagen no existe.');
    }
    this.assertCanWrite(this.ownerConfig(media.ownerType), actor);
    await repo.delete({ id });
    await this.destroyQuietly(media.publicId);
    if (media.ownerType === 'organization') {
      await this.publicMirror.setOrganizationImage(
        media.ownerId,
        media.purpose,
        null,
      );
    }
  }

  private ownerConfig(ownerType: string): MediaOwnerConfig {
    const owner = MEDIA_OWNERS[ownerType];
    if (!owner) {
      throw new BadRequestException(
        `No se pueden cargar imágenes para "${ownerType}".`,
      );
    }
    return owner;
  }

  private purposeConfig(
    owner: MediaOwnerConfig,
    ownerType: string,
    purpose: string,
  ): MediaPurposeConfig {
    const config = owner.purposes[purpose];
    if (!config) {
      throw new BadRequestException(
        `"${purpose}" no es un tipo de imagen válido para ${ownerType}.`,
      );
    }
    return config;
  }

  private assertCanWrite(owner: MediaOwnerConfig, actor: MediaActor): void {
    if (!owner.roles.includes(actor.role)) {
      throw new ForbiddenException('No tenés permisos para esta acción.');
    }
  }

  /**
   * `entity: null` = el owner es la organización misma, y entonces el `ownerId`
   * tiene que ser el del token: nadie carga imágenes en otra organización.
   * Si hay entidad, se busca la fila dentro del schema del tenant, con lo cual
   * tampoco puede apuntar a algo de otra organización.
   */
  private async assertOwnerExists(
    owner: MediaOwnerConfig,
    ownerType: string,
    ownerId: string,
    actor: MediaActor,
  ): Promise<void> {
    if (owner.entity === null) {
      if (ownerId !== actor.orgId) {
        throw new ForbiddenException(
          'No podés cargar imágenes en otra organización.',
        );
      }
      return;
    }

    const manager = await this.tenantContext.getManager();
    const exists = await manager.getRepository(owner.entity).existsBy({
      id: ownerId,
    });
    if (!exists) {
      throw new NotFoundException(`No existe el ${ownerType} indicado.`);
    }
  }

  private assertValidImage(
    file: UploadedFile | undefined,
    config: MediaPurposeConfig,
  ): void {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No llegó ningún archivo.');
    }
    if (file.size > config.maxBytes) {
      throw new PayloadTooLargeException(
        `La imagen supera el máximo de ${Math.round(config.maxBytes / 1_000_000)} MB.`,
      );
    }
    if (!detectImageMime(file.buffer)) {
      throw new BadRequestException(
        `El archivo tiene que ser una imagen ${ALLOWED_MIME_TYPES.join(', ')}.`,
      );
    }
  }

  /** `hornerito/<env>/org_<uuid>/<ownerType>/<ownerId>` */
  private folderFor(orgId: string, ownerType: string, ownerId: string): string {
    const env = process.env.NODE_ENV ?? 'development';
    return `hornerito/${env}/${schemaNameFor(orgId)}/${ownerType}/${ownerId}`;
  }

  private async destroyQuietly(publicId: string): Promise<void> {
    try {
      await this.cloudinary.destroy(publicId);
    } catch (error) {
      this.logger.warn(
        `No se pudo borrar la imagen ${publicId} en Cloudinary: ${String(error)}`,
      );
    }
  }

  private async repo(): Promise<Repository<Media>> {
    const manager = await this.tenantContext.getManager();
    return manager.getRepository(Media);
  }
}
