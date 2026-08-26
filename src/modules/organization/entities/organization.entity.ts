import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum OrganizationStatus {
  PENDING = 'pending',
  VALIDATED = 'validated',
  REJECTED = 'rejected',
}

@Entity('organizations')
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  ownerId: string;

  @Column()
  name: string;

  @Column()
  description: string;

  @Column()
  address: string;

  @Column()
  contact: string;

  @Column({
    type: 'enum',
    enum: OrganizationStatus,
    default: OrganizationStatus.PENDING,
  })
  status: OrganizationStatus;

  @Column({ type: 'varchar', nullable: true })
  rejectReason: string | null;

  /** Prende la sección "Sumate como voluntario" en la ficha pública (QK-16). */
  @Column({ default: false })
  seeksVolunteers: boolean;

  /**
   * Alias o CBU donde recibir donaciones económicas (QK-20). Es el campo que
   * prende la sección "Donar dinero" en la ficha pública: sin él el donante no
   * tiene a dónde transferir, así que el flujo no se ofrece.
   */
  @Column({ type: 'varchar', length: 60, nullable: true })
  paymentAlias: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  paymentHolder: string | null;

  @Column({ type: 'varchar', length: 13, nullable: true })
  paymentCuit: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  paymentBank: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
