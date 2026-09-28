import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export enum EventKind {
  /** Se repite todos los días desde `startDate` hasta hoy o `endedOn`. */
  PERIODIC = 'periodic',
  /** Una sola ocurrencia, en `startDate`. */
  ONE_OFF = 'one_off',
}

/**
 * `OrgEvent` y no `Event` para no chocar con el global `Event` del DOM.
 * Las ocurrencias no se persisten: se derivan de `kind`, `startDate` y
 * `endedOn` (ver migración AddEventsAndAttendance).
 */
@Entity('events')
// Destino de la FK compuesta de `EventAttendance`.
@Unique('UQ_events_org_id', ['organizationId', 'id'])
export class OrgEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column()
  name: string;

  @Column({ type: 'enum', enum: EventKind })
  kind: EventKind;

  /** 'YYYY-MM-DD'. */
  @Column({ type: 'date' })
  startDate: string;

  @Column({ default: true })
  active: boolean;

  /** 'YYYY-MM-DD'; se setea al dar de baja. */
  @Column({ type: 'date', nullable: true })
  endedOn: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
