import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Donación presencial: la carga la organización en el momento de recibirla, no
 * el donante. Por eso no tiene estados — nace recibida — y `createdAt` es la
 * fecha de la entrega.
 */
@Entity('donations')
@Index('IDX_donations_org_createdAt', ['organizationId', 'createdAt'])
// Destino de la FK compuesta de `donation_items`.
@Unique('UQ_donations_org_id', ['organizationId', 'id'])
export class Donation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  /** Null si la donación no llegó a un punto (por ejemplo, a la sede). */
  @Column({ type: 'uuid', nullable: true })
  collectionPointId: string | null;

  /** Null si el donante prefirió no identificarse. */
  @Column({ type: 'varchar', length: 80, nullable: true })
  donorName: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  donorContact: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
