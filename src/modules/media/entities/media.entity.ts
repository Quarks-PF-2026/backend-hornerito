import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { MediaResourceType } from '../media-purposes';

/**
 * Imagen asociada a algo de una organización.
 *
 * `ownerType` + `purpose` se validan contra el registro de `media-purposes.ts`;
 * no son texto libre.
 */
@Entity('media')
@Index(
  'IDX_media_org_owner_purpose',
  ['organizationId', 'ownerType', 'ownerId', 'purpose'],
  // Parcial: `attachment` admite varias filas por owner; el resto sigue
  // siendo un archivo por slot. Tiene que coincidir con la migración.
  { unique: true, where: `"purpose" <> 'attachment'` },
)
@Index(
  'IDX_media_org_owner_attachment',
  ['organizationId', 'ownerType', 'ownerId'],
  { where: `"purpose" = 'attachment'` },
)
@Index('UQ_media_publicId', ['publicId'], { unique: true })
export class Media {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  /** Qué tipo de cosa es dueña de la imagen. Ej: `organization`. */
  @Column()
  ownerType: string;

  /** Id de esa cosa. Para `organization` es el id de la organización. */
  @Column('uuid')
  ownerId: string;

  /** Para qué se usa la imagen dentro del owner. Ej: `logo`, `cover`. */
  @Column()
  purpose: string;

  @Column('text')
  url: string;

  /** Cloudinary separa imágenes y videos: hace falta para poder borrarlo. */
  @Column({ type: 'varchar', default: 'image' })
  resourceType: MediaResourceType;

  /** Identificador en Cloudinary; hace falta para poder borrarla. */
  @Column('text')
  publicId: string;

  @Column()
  format: string;

  @Column('int')
  width: number;

  @Column('int')
  height: number;

  @Column('int')
  bytes: number;

  @Column('uuid')
  createdBy: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
