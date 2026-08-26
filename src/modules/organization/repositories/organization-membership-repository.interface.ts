import { OrganizationMembership } from '../entities/organization-membership.entity';

export const ORGANIZATION_MEMBERSHIP_REPOSITORY = Symbol(
  'ORGANIZATION_MEMBERSHIP_REPOSITORY',
);

export interface IOrganizationMembershipRepository {
  findByUserId(userId: string): Promise<OrganizationMembership[]>;
  findByUserAndOrganization(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationMembership | null>;
  findByOrganizationId(
    organizationId: string,
  ): Promise<OrganizationMembership[]>;
  create(
    membership: Partial<OrganizationMembership>,
  ): Promise<OrganizationMembership>;
  save(membership: OrganizationMembership): Promise<OrganizationMembership>;
}
