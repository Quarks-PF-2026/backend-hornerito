import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

/** Una necesidad cerrada no se muestra ni se puede editar. */
export function isNeedClosed(need: {
  closedManually: boolean;
  coveredQuantity: number;
  requiredQuantity: number;
}): boolean {
  return need.closedManually || need.coveredQuantity >= need.requiredQuantity;
}
