import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  TableInheritance,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export enum DonationKind {
  PRESENCIAL = 'presencial',
  ECONOMICA = 'economica',
}

/**
 * Lo que toda donación tiene, sin importar cómo llegó: a qué organización, de
 * quién y cuándo.
 *
 * Las dos variantes viven en la misma tabla con herencia de tabla única, y
 * `kind` las discrimina. Comparten tabla porque son la misma cosa del dominio —
 * un aporte a la organización — pero no comparten ciclo de vida: la presencial
 * nace recibida (`InPersonDonation`), la económica arranca declarada y espera
 * una decisión (`MonetaryDonation`). Pedirle a un repositorio de una subclase
 * concreta nunca devuelve filas de la otra: TypeORM agrega el filtro por `kind`.
 */
@Entity('donations')
@Index('IDX_donations_org_createdAt', ['organizationId', 'createdAt'])
// Destino de la FK compuesta de `donation_items`.
@Unique('UQ_donations_org_id', ['organizationId', 'id'])
@TableInheritance({
  column: { type: 'enum', enum: DonationKind, name: 'kind' },
})
export class Donation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

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
