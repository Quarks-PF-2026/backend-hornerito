import { OrganizationInvitation } from '../entities/organization-invitation.entity';

export const ORGANIZATION_INVITATION_REPOSITORY = Symbol(
  'ORGANIZATION_INVITATION_REPOSITORY',
);

export interface IOrganizationInvitationRepository {
  findPendingByOrganization(
    organizationId: string,
  ): Promise<OrganizationInvitation[]>;
  findPendingByToken(token: string): Promise<OrganizationInvitation | null>;
  findPendingByEmail(
    organizationId: string,
    email: string,
  ): Promise<OrganizationInvitation | null>;
  findById(id: string): Promise<OrganizationInvitation | null>;
  create(
    invitation: Partial<OrganizationInvitation>,
  ): Promise<OrganizationInvitation>;
  save(invitation: OrganizationInvitation): Promise<OrganizationInvitation>;
  deleteById(id: string): Promise<void>;
}
