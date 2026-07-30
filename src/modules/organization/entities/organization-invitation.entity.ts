import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OrganizationMembershipRole } from './organization-membership.entity';

@Entity('organization_invitations')
@Index(['token'], { unique: true })
export class OrganizationInvitation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  organizationId: string;

  @Column()
  email: string;

  @Column({
    type: 'enum',
    enum: OrganizationMembershipRole,
    default: OrganizationMembershipRole.VOLUNTEER,
  })
  role: OrganizationMembershipRole;

  @Column()
  token: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  @Column()
  invitedByUserId: string;

  @CreateDateColumn()
  createdAt: Date;
}
