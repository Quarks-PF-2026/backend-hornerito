import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { toIsoDate, todayAr } from '../../../common/today-ar';

@Entity('needs')
@Index('IDX_needs_org_supply', ['organizationId', 'supplyId'])
@Index('IDX_needs_org_deadline', ['organizationId', 'deadline'])
export class Need {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column({ type: 'uuid' })
  supplyId: string;

  @Column({ type: 'int' })
  requiredQuantity: number;

  @Column({ type: 'int', default: 0 })
  coveredQuantity: number;

  @Column({ type: 'date' })
  deadline: string;

  @Column({ default: false })
  closedManually: boolean;

  /** Evento al que sirve la necesidad. Opcional: a lo sumo uno. */
  @Column({ type: 'uuid', nullable: true })
  eventId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

/** Vencida: la fecha límite ya pasó (día de calendario en Argentina). */
export function isNeedExpired(need: { deadline: Date | string }): boolean {
  return toIsoDate(need.deadline) < todayAr();
}

/**
 * Una necesidad cerrada no se muestra ni recibe aportes: cerrada a mano,
 * cubierta o vencida. Las dos últimas se derivan, no se persisten.
 */
export function isNeedClosed(need: {
  closedManually: boolean;
  coveredQuantity: number;
  requiredQuantity: number;
  deadline: Date | string;
}): boolean {
  return (
    need.closedManually ||
    need.coveredQuantity >= need.requiredQuantity ||
    isNeedExpired(need)
  );
}
