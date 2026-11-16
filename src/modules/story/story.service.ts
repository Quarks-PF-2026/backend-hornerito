import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EntityManager, IsNull, Raw } from 'typeorm';
import {
  CloudinaryResource,
  CloudinaryService,
  UploadSignature,
} from '../media/cloudinary.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { CreateStoryDto } from './dto/create-story.dto';
import { Story, StoryMediaType } from './entities/story.entity';

/** Tope de vigentes por organización (DOMAIN.md §18). */
export const MAX_LIVE_STORIES = 20;
const LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const MB = 1024 * 1024;
const USED_MESSAGE = 'Esa media ya se usó en otra historia.';

interface KindLimits {
  /** Formatos tal como los informa Cloudinary. */
  formats: readonly string[];
  formatLabel: string;
  maxBytes: number;
  maxDurationSec?: number;
}

const LIMITS: Record<StoryMediaType, KindLimits> = {
  [StoryMediaType.IMAGE]: {
    formats: ['jpg', 'jpeg', 'png', 'webp'],
    formatLabel: 'JPG, PNG o WebP',
    maxBytes: 8 * MB,
  },
  [StoryMediaType.VIDEO]: {
    formats: ['mp4', 'webm'],
    formatLabel: 'MP4 o WebM',
    maxBytes: 20 * MB,
    maxDurationSec: 30,
  },
};

/** Lo que se expone de una historia, en el panel y en la vía pública. */
export interface StoryDto {
  id: string;
  mediaUrl: string;
  mediaType: StoryMediaType;
  durationSec: number | null;
  text: string | null;
  linkUrl: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export function toStoryDto(story: Story): StoryDto {
  return {
    id: story.id,
    mediaUrl: story.mediaUrl,
    mediaType: story.mediaType,
    durationSec: story.durationSec,
    text: story.text,
    linkUrl: story.linkUrl,
    createdAt: story.createdAt,
    expiresAt: story.expiresAt,
  };
}

/**
 * Vigente = no vencida; las eliminadas las excluye `@DeleteDateColumn` en los
 * `find`. Se compara contra `now()` de la base, igual que la vía pública, para
 * que panel e inicio no discrepen por el reloj de la app.
 */
const LIVE = Raw((column) => `${column} > now()`);
const EXPIRED = Raw((column) => `${column} <= now()`);

/** Panel de historias (QK-111): corre bajo `TenantGuard`, con RLS como red. */
@Injectable()
export class StoryService {
  private readonly logger = new Logger(StoryService.name);

  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async list(): Promise<{ active: StoryDto[]; expired: StoryDto[] }> {
    const repo = this.manager().getRepository(Story);
    // ponytail: el historial de vencidas no se pagina; paginar si una
    // organización acumula cientos.
    const [active, expired] = await Promise.all([
      repo.find({
        where: { organizationId: this.orgId, expiresAt: LIVE },
        order: { createdAt: 'DESC' },
      }),
      repo.find({
        where: { organizationId: this.orgId, expiresAt: EXPIRED },
        order: { expiresAt: 'DESC' },
      }),
    ]);
    return { active: active.map(toStoryDto), expired: expired.map(toStoryDto) };
  }

  /**
   * Paso 1 de la subida directa (mismo flujo que los adjuntos de `media`): el
   * `publicId` lo elige el backend dentro de la carpeta de la organización, y
   * `create` solo acepta esa forma. El tope se mira acá para no firmar de más y
   * se vuelve a mirar al crear.
   */
  async sign(
    resourceType: StoryMediaType,
  ): Promise<UploadSignature & { publicId: string }> {
    await this.assertRoom(this.manager());
    const publicId = `${this.folder()}/${randomUUID()}`;
    return {
      ...this.cloudinary.signUpload(publicId, LIMITS[resourceType].formats),
      publicId,
    };
  }

  /**
   * Frontera de confianza: del cliente solo se toma qué archivo es. Formato,
   * tamaño y duración se leen de Cloudinary, y lo que no cumple se borra ahí
   * mismo para no dejarlo huérfano.
   */
  async create(dto: CreateStoryDto, userId: string): Promise<StoryDto> {
    // Antes que nada: con el cupo lleno no hay nada que leer ni borrar.
    await this.assertRoom(this.manager());

    // Solo la forma exacta que firma `sign`. Otra carpeta es un archivo ajeno
    // (de otra organización o de otro módulo): ni se consulta ni se borra.
    const expected = new RegExp(
      `^${escapeRegExp(this.folder())}/[0-9a-f-]{36}$`,
    );
    if (!expected.test(dto.publicId)) {
      throw new BadRequestException(
        'El archivo no corresponde a esta organización.',
      );
    }

    // Doble submit: el archivo ya es de una historia (vigente, vencida o
    // eliminada). Se rechaza antes de tocar Cloudinary y sin borrar nada.
    if (await this.isUsed(this.manager(), dto.publicId)) {
      throw new BadRequestException(USED_MESSAGE);
    }

    const resource = await this.cloudinary.getResource(
      dto.publicId,
      dto.resourceType,
    );
    if (!resource) {
      // El tipo lo dice el cliente: si el archivo existe con el otro, se borra
      // igual, para que un alta mal armada no deje un huérfano.
      const other =
        dto.resourceType === StoryMediaType.IMAGE
          ? StoryMediaType.VIDEO
          : StoryMediaType.IMAGE;
      if (await this.cloudinary.getResource(dto.publicId, other)) {
        await this.destroyQuietly(dto.publicId, other);
        throw new BadRequestException(
          'El tipo del archivo no coincide con lo que se subió.',
        );
      }
      throw new BadRequestException('El archivo no existe en Cloudinary.');
    }

    const problem = mediaProblem(dto.resourceType, resource);
    if (problem) {
      await this.destroyQuietly(dto.publicId, dto.resourceType);
      throw new BadRequestException(problem);
    }

    try {
      return await this.manager().transaction(async (tx) => {
        // Serializa las altas de la organización: sin esto, dos altas
        // simultáneas con 19 vigentes cuentan 19 las dos y quedan 21.
        await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `stories:${this.orgId}`,
        ]);
        if (await this.isUsed(tx, dto.publicId)) {
          throw new BadRequestException(USED_MESSAGE);
        }
        await this.assertRoom(tx);
        const repo = tx.getRepository(Story);
        const now = Date.now();
        const saved = await repo.save(
          repo.create({
            organizationId: this.orgId,
            createdByUserId: userId,
            mediaUrl: resource.url,
            mediaPublicId: resource.publicId,
            mediaType: dto.resourceType,
            durationSec:
              dto.resourceType === StoryMediaType.VIDEO
                ? (resource.duration ?? null)
                : null,
            text: dto.text ?? null,
            linkUrl: dto.linkUrl ?? null,
            createdAt: new Date(now),
            expiresAt: new Date(now + LIFETIME_MS),
          }),
        );
        return toStoryDto(saved);
      });
    } catch (error) {
      await this.destroyQuietly(dto.publicId, dto.resourceType);
      throw error;
    }
  }

  /** Borrado lógico (invariante 19): libera cupo y conserva el registro. */
  async remove(id: string): Promise<void> {
    const result = await this.manager()
      .getRepository(Story)
      .update(
        { id, organizationId: this.orgId, deletedAt: IsNull() },
        { deletedAt: () => 'now()' },
      );
    if (!result.affected) {
      throw new NotFoundException('La historia no existe.');
    }
  }

  private async assertRoom(manager: EntityManager): Promise<void> {
    const live = await manager.getRepository(Story).countBy({
      organizationId: this.orgId,
      expiresAt: LIVE,
    });
    if (live >= MAX_LIVE_STORIES) {
      throw new BadRequestException(
        `La organización ya tiene ${MAX_LIVE_STORIES} historias vigentes: eliminá una para publicar otra.`,
      );
    }
  }

  /** `hornerito/<env>/<orgId>/stories`, junto a la carpeta de `media`. */
  private folder(): string {
    const env = process.env.NODE_ENV ?? 'development';
    return `hornerito/${env}/${this.orgId}/stories`;
  }

  private isUsed(manager: EntityManager, publicId: string): Promise<boolean> {
    return manager.getRepository(Story).exists({
      where: { organizationId: this.orgId, mediaPublicId: publicId },
      withDeleted: true,
    });
  }

  /**
   * Nunca borra un archivo que ya referencia una historia: un rechazo del
   * segundo envío de un doble submit no puede llevarse la media del primero.
   * Si el chequeo falla, tampoco se borra (huérfano antes que pérdida).
   *
   * ponytail: sin UNIQUE en la base queda una ventana de carrera mínima entre
   * este chequeo y el destroy (otra alta con el mismo publicId que commitea en
   * el medio). Upgrade: UNIQUE("mediaPublicId") en una migración, y entonces
   * el 23505 del insert reemplaza a los chequeos.
   */
  private async destroyQuietly(
    publicId: string,
    resourceType: StoryMediaType,
  ): Promise<void> {
    try {
      if (await this.isUsed(this.manager(), publicId)) {
        return;
      }
      await this.cloudinary.destroy(publicId, resourceType);
    } catch (error) {
      this.logger.warn(
        `No se pudo borrar ${publicId} en Cloudinary: ${String(error)}`,
      );
    }
  }

  private get orgId(): string {
    return this.tenantContext.organizationId;
  }

  private manager(): EntityManager {
    return this.tenantContext.getManager();
  }
}

/** Mensaje de rechazo, o null si el archivo cumple (DOMAIN.md §18, Contenido). */
function mediaProblem(
  type: StoryMediaType,
  resource: CloudinaryResource,
): string | null {
  const limits = LIMITS[type];
  const noun = type === StoryMediaType.IMAGE ? 'La imagen' : 'El video';
  if (!limits.formats.includes(resource.format)) {
    return `El formato del archivo tiene que ser ${limits.formatLabel}.`;
  }
  if (resource.bytes > limits.maxBytes) {
    return `${noun} no puede superar los ${limits.maxBytes / MB} MB.`;
  }
  // Un video sin duración informada no se puede verificar: se rechaza.
  if (
    limits.maxDurationSec !== undefined &&
    !((resource.duration ?? Infinity) <= limits.maxDurationSec)
  ) {
    return `${noun} no puede durar más de ${limits.maxDurationSec} segundos.`;
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
