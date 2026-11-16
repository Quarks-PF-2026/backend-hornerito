import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export enum StoryMediaType {
  IMAGE = 'image',
  VIDEO = 'video',
}

/**
 * Historia de una organización (QK-111, DOMAIN.md §18). Vencimiento perezoso:
 * no hay job, toda lectura compara `expiresAt` contra `now()` (ver migración
 * AddStories).
 */
@Entity('stories')
// Destino de la FK compuesta de `StoryView`.
@Unique('UQ_stories_org_id', ['organizationId', 'id'])
export class Story {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  /** NULL si la cuenta que la publicó se borró (`ON DELETE SET NULL`). */
  @Column({ type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @Column({ type: 'text' })
  mediaUrl: string;

  /** Hace falta para borrar el archivo en Cloudinary. */
  @Column({ type: 'varchar', length: 200 })
  mediaPublicId: string;

  @Column({ type: 'enum', enum: StoryMediaType })
  mediaType: StoryMediaType;

  /**
   * Solo videos. `pg` devuelve `numeric` como string para no perder precisión;
   * con dos decimales y ≤ 30 s un `number` alcanza.
   */
  @Column({
    type: 'numeric',
    precision: 6,
    scale: 2,
    nullable: true,
    transformer: {
      to: (value: number | null) => value,
      from: (value: string | null) => (value === null ? null : Number(value)),
    },
  })
  durationSec: number | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  text: string | null;

  /** Solo `http(s)`: lo valida el DTO y lo respalda `CHK_stories_linkUrl`. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  linkUrl: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  /** Lo fija el service al publicar (alta + 7 días). */
  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  /**
   * Borrado lógico: nunca hay DELETE físico (invariante 19) y `hornerito_app`
   * no tiene permiso para hacerlo. Con `@DeleteDateColumn`, `softDelete()`
   * setea la columna y los `find` excluyen las eliminadas solos; una query
   * cruda (vía pública) tiene que filtrar `"deletedAt" IS NULL` a mano.
   */
  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt: Date | null;
}
