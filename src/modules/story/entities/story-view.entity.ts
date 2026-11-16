import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * Una historia que un usuario con cuenta ya abrió. Los visitantes sin cuenta
 * no generan filas. Se escribe por la vía pública como owner, fuera de un
 * tenant (ver migración AddStories); `organizationId` está para la FK
 * compuesta, que impide colgar una vista de una historia de otra organización.
 */
@Entity('story_views')
export class StoryView {
  /** PK `(storyId, userId)`: registrar dos veces la misma vista no duplica. */
  @PrimaryColumn('uuid')
  storyId: string;

  @PrimaryColumn('uuid')
  userId: string;

  @Column('uuid')
  organizationId: string;

  @CreateDateColumn({ type: 'timestamptz' })
  viewedAt: Date;
}
