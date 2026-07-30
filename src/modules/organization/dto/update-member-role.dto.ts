import { IsIn } from 'class-validator';
import {
  ASSIGNABLE_ROLES,
  OrganizationMembershipRole,
} from '../entities/organization-membership.entity';

export class UpdateMemberRoleDto {
  @IsIn(ASSIGNABLE_ROLES, { message: 'El rol no es válido.' })
  role: OrganizationMembershipRole;
}
