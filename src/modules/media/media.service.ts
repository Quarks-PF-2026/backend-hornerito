import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { In, QueryFailedError, Repository } from 'typeorm';
import { OrganizationMembershipRole } from '../organization/entities/organization-membership.entity';
import { TenantContextService } from '../tenant/tenant-context.service';
import { CloudinaryService, UploadSignature } from './cloudinary.service';
import { Media } from './entities/media.entity';
import {
  ALLOWED_MIME_TYPES,
  MEDIA_OWNERS,
  MediaOwnerConfig,
  MediaPurposeConfig,
  MediaResourceType,
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

export interface ConfirmedUpload {
  publicId: string;
  resourceType: MediaResourceType;
}

/** Lo que se expone de un adjunto, en el listado propio y en el público. */
export interface MediaView {
  id: string;
  url: string;
  resourceType: MediaResourceType;
  width: number;
  height: number;
}

/** Agrupa filas por `ownerId`, respetando el orden en que llegan. */
export function mediaByOwner(rows: Media[]): Map<string, MediaView[]> {
  const byOwner = new Map<string, MediaView[]>();
  for (const row of rows) {
    const list = byOwner.get(row.ownerId) ?? [];
    list.push({
      id: row.id,
      url: row.url,
      resourceType: row.resourceType,
      width: row.width,
      height: row.height,
    });
    byOwner.set(row.ownerId, list);
  }
  return byOwner;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async listFor(
    ownerType: string,
    ownerId: string,
    actor: MediaActor,
  ): Promise<Media[]> {
    const owner = this.ownerConfig(ownerType);
    await this.assertOwnerExists(owner, ownerType, ownerId, actor);
    return this.repo().find({
      where: { organizationId: this.orgId, ownerType, ownerId },
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
    if (!config.maxBytes || !config.transformation) {
      throw new BadRequestException(
        `"${purpose}" se sube directo a Cloudinary, no por este endpoint.`,
      );
    }
    this.assertCanWrite(owner, actor);
    await this.assertOwnerExists(owner, ownerType, ownerId, actor);
    this.assertValidImage(file, config.maxBytes);

    // ponytail: la subida es I/O de red hecha con la conexión del tenant
    // retenida por `TenantContextInterceptor`. No deadlockea —no pide una
    // segunda conexión— pero monopoliza un slot del pool mientras Cloudinary
    // responde. El techo se sube sacando la subida de la sección crítica; es
    // además el prerrequisito para volver al pooler con `SET LOCAL`.
    const uploaded = await this.cloudinary.upload(file!.buffer, {
      folder: this.folderFor(actor.orgId, ownerType, ownerId),
      transformation: config.transformation,
    });

    const repo = this.repo();
    const existing = await repo.findOneBy({
      organizationId: this.orgId,
      ownerType,
      ownerId,
      purpose,
    });
    const saved = await repo.save(
      repo.create({
        ...(existing ?? {}),
        organizationId: this.orgId,
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

    return saved;
  }

  /**
   * Primer paso de la subida directa: el navegador sube a Cloudinary con esta
   * firma y después llama a `confirmFor`. El tope se mira acá para no firmar
   * de más, y se vuelve a mirar al confirmar (dos pestañas pueden firmar a la
   * vez).
   *
   * ponytail: una firma usada pero nunca confirmada deja el archivo huérfano
   * en Cloudinary (pestaña cerrada a mitad de camino). El techo es espacio
   * desperdiciado, no datos expuestos: nada lo referencia. Si crece, una
   * limpieza periódica por carpeta que borre lo que no tenga fila en `media`.
   */
  async signFor(
    ownerType: string,
    ownerId: string,
    purpose: string,
    actor: MediaActor,
  ): Promise<UploadSignature> {
    const { owner, direct } = this.directConfig(ownerType, purpose);
    this.assertCanWrite(owner, actor);
    await this.assertOwnerExists(owner, ownerType, ownerId, actor);
    if (await this.isFull(ownerType, ownerId, purpose, direct.maxItems)) {
      throw new BadRequestException(
        `Se pueden adjuntar hasta ${direct.maxItems} archivos.`,
      );
    }
    const folder = this.folderFor(actor.orgId, ownerType, ownerId);
    return this.cloudinary.signUpload(
      `${folder}/${randomUUID()}`,
      Object.values(direct.kinds).flatMap((kind) => kind.formats),
    );
  }

  /**
   * Frontera de confianza de la subida directa: del cliente solo se toma qué
   * archivo es. Tamaño, formato y dimensiones se leen de Cloudinary, y lo que
   * no cumple se borra ahí mismo para no dejarlo huérfano.
   */
  async confirmFor(
    ownerType: string,
    ownerId: string,
    purpose: string,
    upload: ConfirmedUpload,
    actor: MediaActor,
  ): Promise<Media> {
    const { owner, direct } = this.directConfig(ownerType, purpose);
    this.assertCanWrite(owner, actor);
    await this.assertOwnerExists(owner, ownerType, ownerId, actor);

    // Solo se acepta la forma exacta que firma `signFor`: carpeta del owner
    // (incluye la org) + un uuid. Cualquier otra cosa es un archivo ajeno, y
    // no se toca ni se consulta en Cloudinary.
    const folder = this.folderFor(actor.orgId, ownerType, ownerId);
    const expected = new RegExp(`^${escapeRegExp(folder)}/[0-9a-f-]{36}$`);
    if (!expected.test(upload.publicId)) {
      throw new ForbiddenException('El archivo no corresponde a este destino.');
    }

    const resource = await this.cloudinary.getResource(
      upload.publicId,
      upload.resourceType,
    );
    if (!resource) {
      // El tipo lo dice el cliente: si el archivo existe con el otro, se borra
      // igual, para que una confirmación mal armada no deje un huérfano.
      const other = upload.resourceType === 'image' ? 'video' : 'image';
      if (await this.cloudinary.getResource(upload.publicId, other)) {
        await this.destroyQuietly(upload.publicId, other);
        throw new BadRequestException(
          'El tipo del archivo no coincide con lo que se subió.',
        );
      }
      throw new BadRequestException('El archivo no existe en Cloudinary.');
    }

    const limits = direct.kinds[upload.resourceType];
    const reject = async (error: Error): Promise<never> => {
      await this.destroyQuietly(upload.publicId, upload.resourceType);
      throw error;
    };
    if (!limits.formats.includes(resource.format)) {
      await reject(
        new BadRequestException(
          `El archivo tiene que ser ${limits.formats.join(', ')}.`,
        ),
      );
    }
    if (resource.bytes > limits.maxBytes) {
      await reject(
        new PayloadTooLargeException(
          `El archivo supera el máximo de ${Math.round(limits.maxBytes / 1_000_000)} MB.`,
        ),
      );
    }
    // ponytail: contar y guardar no es atómico; dos confirmaciones simultáneas
    // pueden pasar el tope por uno. Un lock por owner si alguna vez importa.
    if (await this.isFull(ownerType, ownerId, purpose, direct.maxItems)) {
      await reject(
        new BadRequestException(
          `Se pueden adjuntar hasta ${direct.maxItems} archivos.`,
        ),
      );
    }

    const repo = this.repo();
    try {
      return await repo.save(
        repo.create({
          organizationId: this.orgId,
          ownerType,
          ownerId,
          purpose,
          resourceType: upload.resourceType,
          url: resource.url,
          publicId: resource.publicId,
          format: resource.format,
          width: resource.width,
          height: resource.height,
          bytes: resource.bytes,
          createdBy: actor.userId,
        }),
      );
    } catch (error) {
      // `UQ_media_publicId`: confirmar dos veces el mismo archivo dejaría dos
      // filas apuntando a él, y borrar una rompería la otra. No se borra de
      // Cloudinary: la fila que ya existe lo sigue usando.
      const code =
        error instanceof QueryFailedError
          ? (error.driverError as { code?: string } | undefined)?.code
          : undefined;
      if (code === '23505') {
        throw new BadRequestException('Ese archivo ya está adjuntado.');
      }
      throw error;
    }
  }

  /**
   * Adjuntos de varios owners en una sola query, para no hacer una por fila
   * del listado. Ordenados por `createdAt`: el orden en que se subieron.
   */
  async listForOwners(
    ownerType: string,
    ownerIds: string[],
  ): Promise<Map<string, MediaView[]>> {
    if (ownerIds.length === 0) {
      return new Map();
    }
    const rows = await this.repo().find({
      where: { organizationId: this.orgId, ownerType, ownerId: In(ownerIds) },
      order: { createdAt: 'ASC' },
    });
    return mediaByOwner(rows);
  }

  /**
   * Borra todo lo del owner, en la base y en Cloudinary. No chequea rol: lo
   * llama el service del owner, que ya validó que se puede borrar.
   */
  async removeAllFor(ownerType: string, ownerId: string): Promise<void> {
    const repo = this.repo();
    const rows = await repo.findBy({
      organizationId: this.orgId,
      ownerType,
      ownerId,
    });
    if (rows.length === 0) {
      return;
    }
    await repo.delete({ organizationId: this.orgId, ownerType, ownerId });
    await Promise.all(
      rows.map((row) => this.destroyQuietly(row.publicId, row.resourceType)),
    );
  }

  async remove(id: string, actor: MediaActor): Promise<void> {
    const repo = this.repo();
    const media = await repo.findOneBy({ id, organizationId: this.orgId });
    if (!media) {
      throw new NotFoundException('La imagen no existe.');
    }
    this.assertCanWrite(this.ownerConfig(media.ownerType), actor);
    await repo.delete({ id, organizationId: this.orgId });
    await this.destroyQuietly(media.publicId, media.resourceType);
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

  private directConfig(
    ownerType: string,
    purpose: string,
  ): {
    owner: MediaOwnerConfig;
    direct: NonNullable<MediaPurposeConfig['direct']>;
  } {
    const owner = this.ownerConfig(ownerType);
    const { direct } = this.purposeConfig(owner, ownerType, purpose);
    if (!direct) {
      throw new BadRequestException(
        `"${purpose}" se sube por el backend, no directo a Cloudinary.`,
      );
    }
    return { owner, direct };
  }

  private async isFull(
    ownerType: string,
    ownerId: string,
    purpose: string,
    maxItems: number,
  ): Promise<boolean> {
    const count = await this.repo().countBy({
      organizationId: this.orgId,
      ownerType,
      ownerId,
      purpose,
    });
    return count >= maxItems;
  }

  private assertCanWrite(owner: MediaOwnerConfig, actor: MediaActor): void {
    if (!owner.roles.includes(actor.role)) {
      throw new ForbiddenException('No tenés permisos para esta acción.');
    }
  }

  /**
   * `entity: null` = el owner es la organización misma, y entonces el `ownerId`
   * tiene que ser el del token: nadie carga imágenes en otra organización.
   * Si hay entidad, se busca la fila filtrando por `organizationId`, con lo
   * cual tampoco puede apuntar a algo de otra organización.
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

    const exists = await this.tenantContext
      .getManager()
      .getRepository(owner.entity)
      .existsBy({
        id: ownerId,
        organizationId: this.orgId,
      });
    if (!exists) {
      throw new NotFoundException(`No existe el ${ownerType} indicado.`);
    }
  }

  private assertValidImage(
    file: UploadedFile | undefined,
    maxBytes: number,
  ): void {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No llegó ningún archivo.');
    }
    if (file.size > maxBytes) {
      throw new PayloadTooLargeException(
        `La imagen supera el máximo de ${Math.round(maxBytes / 1_000_000)} MB.`,
      );
    }
    if (!detectImageMime(file.buffer)) {
      throw new BadRequestException(
        `El archivo tiene que ser una imagen ${ALLOWED_MIME_TYPES.join(', ')}.`,
      );
    }
  }

  /** `hornerito/<env>/<orgId>/<ownerType>/<ownerId>` */
  private folderFor(orgId: string, ownerType: string, ownerId: string): string {
    const env = process.env.NODE_ENV ?? 'development';
    return `hornerito/${env}/${orgId}/${ownerType}/${ownerId}`;
  }

  private async destroyQuietly(
    publicId: string,
    resourceType: MediaResourceType = 'image',
  ): Promise<void> {
    try {
      await this.cloudinary.destroy(publicId, resourceType);
    } catch (error) {
      this.logger.warn(
        `No se pudo borrar la imagen ${publicId} en Cloudinary: ${String(error)}`,
      );
    }
  }

  private get orgId(): string {
    return this.tenantContext.organizationId;
  }

  private repo(): Repository<Media> {
    return this.tenantContext.getManager().getRepository(Media);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
