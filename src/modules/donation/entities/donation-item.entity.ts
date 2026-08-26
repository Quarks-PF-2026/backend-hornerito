import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Un insumo dentro de una donación. La unidad no se copia: sale de
 * `supplies.unit` al leer, igual que hace `needs`.
 *
 * `organizationId` está repetido acá porque la política RLS filtra por esa
 * columna en cada tabla.
 */
@Entity('donation_items')
@Index('IDX_donation_items_org_donation', ['organizationId', 'donationId'])
export class DonationItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column('uuid')
  donationId: string;

  @Column('uuid')
  supplyId: string;

  /** Null si el insumo donado no cubre ninguna necesidad publicada. */
  @Column({ type: 'uuid', nullable: true })
  needId: string | null;

  @Column({ type: 'int' })
  quantity: number;

  @CreateDateColumn()
  createdAt: Date;
}
