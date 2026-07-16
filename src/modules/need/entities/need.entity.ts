import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('needs')
export class Need {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
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
