import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum VolunteerRequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

/**
 * Alguien de afuera que se ofrece como voluntario desde la ficha pública
 * (QK-16). No es una `VolunteerApplication`: esa exige un `userId` de un
 * miembro que ya existe, y acá todavía no hay cuenta — la solicitud es previa
 * al alta. El `User` y la membresía nacen recién cuando la persona acepta la
 * invitación que se le manda al aprobarla.
 */
@Entity('volunteer_requests')
@Index('IDX_volunteer_requests_org_status', [
  'organizationId',
  'status',
  'createdAt',
])
@Index('IDX_volunteer_requests_org_opportunity', [
  'organizationId',
  'opportunityId',
])
export class VolunteerRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  /** `null` = se ofreció a la organización en general, no a una actividad. */
  @Column({ type: 'uuid', nullable: true })
  opportunityId: string | null;

  /** En qué quiere ayudar. Solo aplica al caso "a la organización". */
  @Column({ type: 'uuid', nullable: true })
  volunteerTypeId: string | null;

  @Column()
  name: string;

  /** Normalizado a minúsculas: alimenta a `MemberService.invite`, que compara así. */
  @Column()
  email: string;

  @Column({ type: 'varchar', nullable: true })
  phone: string | null;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  @Column({
    type: 'enum',
    enum: VolunteerRequestStatus,
    default: VolunteerRequestStatus.PENDING,
  })
  status: VolunteerRequestStatus;

  @Column({ type: 'varchar', nullable: true })
  rejectReason: string | null;

  /** Traza de la invitación emitida al aprobar. */
  @Column({ type: 'uuid', nullable: true })
  invitationId: string | null;

  @Column({ type: 'uuid', nullable: true })
  decidedByUserId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
