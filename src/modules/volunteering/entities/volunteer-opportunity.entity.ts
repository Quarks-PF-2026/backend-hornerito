import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum OpportunityStatus {
  OPEN = 'open',
  CLOSED = 'closed',
  CANCELLED = 'cancelled',
}

@Entity('volunteer_opportunities')
@Index('IDX_volunteer_opportunities_org_startsAt', [
  'organizationId',
  'startsAt',
])
export class VolunteerOpportunity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column()
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'timestamptz' })
  startsAt: Date;

  @Column()
  location: string;

  @Column({ type: 'int' })
  capacity: number;

  @Column({ type: 'int', default: 0 })
  acceptedCount: number;

  @Column({
    type: 'enum',
    enum: OpportunityStatus,
    default: OpportunityStatus.OPEN,
  })
  status: OpportunityStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

/**
 * El cupo lleno no se persiste como un cuarto estado: se deriva. Una
 * oportunidad deja de aceptar postulaciones cuando la cerraron/cancelaron a
 * mano o cuando ya aceptó tantos voluntarios como cupos tiene.
 */
export function isOpportunityOpen(opportunity: {
  status: OpportunityStatus;
  acceptedCount: number;
  capacity: number;
}): boolean {
  return (
    opportunity.status === OpportunityStatus.OPEN &&
    opportunity.acceptedCount < opportunity.capacity
  );
}
