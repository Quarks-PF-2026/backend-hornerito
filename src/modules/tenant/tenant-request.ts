import type { QueryRunner } from 'typeorm';
import type { Organization } from '../organization/entities/organization.entity';
import type { OrganizationMembership } from '../organization/entities/organization-membership.entity';

/** Lo que `TenantGuard` y `TenantContextInterceptor` cuelgan de la request. */
export interface TenantScopedRequest {
  user?: { id?: string; orgId?: string };
  organization?: Organization;
  membership?: OrganizationMembership;
  tenantQueryRunner?: QueryRunner;
}
