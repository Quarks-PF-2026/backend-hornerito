import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  OrganizationMembership,
  OrganizationMembershipRole,
} from '../../organization/entities/organization-membership.entity';
import { ROLES_KEY } from '../decorators/roles.decorator';

interface RolesGuardedRequest {
  membership?: OrganizationMembership;
}

/**
 * Compara el rol de la membresía activa (la carga TenantGuard) contra los
 * roles declarados con @Roles(). Sin @Roles() el handler queda abierto a
 * cualquier miembro activo de la organización.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<
      OrganizationMembershipRole[] | undefined
    >(ROLES_KEY, [context.getHandler(), context.getClass()]);

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RolesGuardedRequest>();
    const role = request.membership?.role;
    if (!role || !required.includes(role)) {
      throw new ForbiddenException('No tenés permisos para esta acción.');
    }
    return true;
  }
}
