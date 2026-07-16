import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum OrganizationMembershipRole {
  OWNER = 'owner',
}

@Entity('organization_memberships')
@Index(['userId', 'organizationId'], { unique: true })
export class OrganizationMembership {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  organizationId: string;

  @Column({
    type: 'enum',
    enum: OrganizationMembershipRole,
    default: OrganizationMembershipRole.OWNER,
  })
  role: OrganizationMembershipRole;

  @CreateDateColumn()
  createdAt: Date;
}
