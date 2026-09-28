import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/** Conteo de asistentes de una ocurrencia (evento, fecha). */
@Entity('event_attendances')
// Target del upsert `ON CONFLICT`: un conteo por evento y día.
@Unique('UQ_event_attendances_event_date', ['eventId', 'date'])
export class EventAttendance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column('uuid')
  eventId: string;

  /** 'YYYY-MM-DD'. */
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'int' })
  count: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
