import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Franja horaria de un día de la semana (0 = domingo … 6 = sábado). */
export interface ScheduleDay {
  day: number;
  closed: boolean;
  /** `HH:mm`, null si el día está cerrado. */
  open: string | null;
  /** `HH:mm`, null si el día está cerrado. */
  close: string | null;
}

/** TypeORM devuelve `decimal` como string; lo normalizamos a number. */
const decimalToNumber = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

@Entity('collection_points')
@Index('IDX_collection_points_org_active', ['organizationId', 'active'])
export class CollectionPoint {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column()
  name: string;

  @Column()
  addressLine: string;

  @Column({
    type: 'decimal',
    precision: 9,
    scale: 6,
    transformer: decimalToNumber,
  })
  latitude: number;

  @Column({
    type: 'decimal',
    precision: 9,
    scale: 6,
    transformer: decimalToNumber,
  })
  longitude: number;

  @Column()
  phone: string;

  @Column({ type: 'varchar', nullable: true })
  email: string | null;

  @Column({ type: 'varchar', nullable: true })
  contactName: string | null;

  @Column({ type: 'jsonb' })
  schedule: ScheduleDay[];

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
