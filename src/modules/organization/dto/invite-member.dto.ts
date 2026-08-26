import { IsEmail, IsIn } from 'class-validator';
import {
  ASSIGNABLE_ROLES,
  OrganizationMembershipRole,
} from '../entities/organization-membership.entity';

export class InviteMemberDto {
  @IsEmail({}, { message: 'El correo no tiene un formato válido.' })
  email: string;

  @IsIn(ASSIGNABLE_ROLES, { message: 'El rol no es válido.' })
  role: OrganizationMembershipRole;
}
