import { Column, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Espejo en el schema `public` de las necesidades que viven en los schemas de
 * cada organización. Existe solo para el directorio público (listado, búsqueda
 * y feed global); la fuente de verdad sigue siendo `Need` en el tenant.
 *
 * `id` es el mismo id que la necesidad original, así el upsert es directo.
 */
@Entity('public_needs')
export class PublicNeed {
  @PrimaryColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  organizationId: string;

  @Index()
  @Column('uuid')
  supplyId: string;

  @Column('text')
  supplyName: string;

  @Column('text')
  supplyCategory: string;

  @Column('text')
  supplyUnit: string;

  @Column('int')
  requiredQuantity: number;

  @Column({ type: 'int', default: 0 })
  coveredQuantity: number;

  @Column({ type: 'date' })
  deadline: string;

  @Column({ default: false })
  closed: boolean;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
