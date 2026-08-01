import { EntityTarget, ObjectLiteral } from 'typeorm';
import {
  MEMBER_MANAGER_ROLES,
  OrganizationMembershipRole,
} from '../organization/entities/organization-membership.entity';

/**
 * Punto de extensión del módulo: para que un tipo de entidad nueva acepte
 * imágenes, se agrega una entrada acá. No hace falta tocar el service, el
 * controller ni la tabla.
 */
export interface MediaPurposeConfig {
  maxBytes: number;
  /** Se aplica en Cloudinary al subir, para no guardar el original completo. */
  transformation: { width: number; height: number; crop: 'fill' | 'limit' };
}

export interface MediaOwnerConfig {
  /**
   * Entidad tenant dueña de la imagen; el service verifica que la fila exista
   * antes de subir. `null` significa que el owner es la organización misma, y
   * entonces el `ownerId` tiene que ser el de la organización del token.
   */
  entity: EntityTarget<ObjectLiteral> | null;
  /** Roles habilitados para subir o borrar imágenes de este owner. */
  roles: readonly OrganizationMembershipRole[];
  purposes: Record<string, MediaPurposeConfig>;
}

export const MEDIA_OWNERS: Record<string, MediaOwnerConfig> = {
  organization: {
    entity: null,
    roles: MEMBER_MANAGER_ROLES,
    purposes: {
      logo: {
        maxBytes: 5_000_000,
        transformation: { width: 512, height: 512, crop: 'fill' },
      },
      cover: {
        maxBytes: 8_000_000,
        transformation: { width: 1600, height: 600, crop: 'fill' },
      },
    },
  },
};

/** Tope duro del interceptor de subida: ningún purpose puede pedir más. */
export const MAX_UPLOAD_BYTES = 8_000_000;

/**
 * Los tres formatos que aceptamos, con sus magic bytes. El `mimetype` del
 * request lo manda el cliente y es falsificable, así que además se mira el
 * contenido real del archivo.
 */
const SIGNATURES: { mime: string; matches: (buffer: Buffer) => boolean }[] = [
  {
    mime: 'image/jpeg',
    matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/png',
    matches: (b) =>
      b
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: 'image/webp',
    matches: (b) =>
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];

export const ALLOWED_MIME_TYPES = SIGNATURES.map((s) => s.mime);

/** Devuelve el mime real del buffer, o null si no es una imagen soportada. */
export function detectImageMime(buffer: Buffer): string | null {
  if (buffer.length < 12) {
    return null;
  }
  return SIGNATURES.find((s) => s.matches(buffer))?.mime ?? null;
}
