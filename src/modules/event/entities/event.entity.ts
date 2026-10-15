import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export enum EventKind {
  /** Se repite en sus `weekdays` desde `startDate` hasta hoy o `endedOn`. */
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

  /**
   * 0 = domingo … 6 = sábado, ordenados. Periódico: al menos uno (diario = los
   * siete); extraordinario: null. Lo sostiene `CHK_events_weekdays`. El driver
   * `pg` ya devuelve `smallint[]` como números.
   */
  @Column({ type: 'smallint', array: true, nullable: true })
  weekdays: number[] | null;

  /**
   * 'HH:MM', 24 h. Informativa: no restringe la carga de asistencia.
   * Postgres devuelve `time` como 'HH:MM:SS'; se recorta para que la API
   * hable el mismo formato que recibe.
   */
  @Column({
    type: 'time',
    transformer: {
      to: (value: string) => value,
      from: (value: string | null) => value?.slice(0, 5) ?? value,
    },
  })
  startTime: string;

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
