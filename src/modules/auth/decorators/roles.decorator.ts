import { SetMetadata } from '@nestjs/common';
import { OrganizationMembershipRole } from '../../organization/entities/organization-membership.entity';

export const ROLES_KEY = 'roles';

export const Roles = (...roles: OrganizationMembershipRole[]) =>
  SetMetadata(ROLES_KEY, roles);
