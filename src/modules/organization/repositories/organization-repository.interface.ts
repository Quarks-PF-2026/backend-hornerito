import { Organization } from '../entities/organization.entity';

export const ORGANIZATION_REPOSITORY = Symbol('ORGANIZATION_REPOSITORY');

export interface IOrganizationRepository {
  findByOwnerId(ownerId: string): Promise<Organization | null>;
  create(organization: Partial<Organization>): Promise<Organization>;
  save(organization: Organization): Promise<Organization>;
}
