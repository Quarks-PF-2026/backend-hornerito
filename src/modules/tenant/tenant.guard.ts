import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import {
  Organization,
  OrganizationStatus,
} from '../organization/entities/organization.entity';
import { OrganizationMembership } from '../organization/entities/organization-membership.entity';

interface TenantGuardedRequest {
  user?: { id?: string; orgId?: string };
  organization?: Organization;
  membership?: OrganizationMembership;
}

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    @InjectRepository(OrganizationMembership)
    private readonly membershipRepository: Repository<OrganizationMembership>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TenantGuardedRequest>();
    const orgId = request.user?.orgId;
    if (!orgId) {
      throw new ForbiddenException(
        'No hay una organización activa en la sesión.',
      );
    }

    const organization = await this.organizationRepository.findOneBy({
      id: orgId,
    });
    if (!organization || organization.status !== OrganizationStatus.VALIDATED) {
      throw new ForbiddenException('La organización no está habilitada.');
    }

    // La membresía se lee en cada request (y no del JWT) para que deshabilitar
    // a un usuario o cambiarle el rol surta efecto sin esperar a que expire su
    // token.
    let membership: OrganizationMembership | null;
    try {
      membership = await this.membershipRepository.findOneBy({
        userId: request.user?.id,
        organizationId: orgId,
      });
    } catch (error) {
      // Un id mal formado (ej. un JWT armado a mano, o corrupto) no es "no
      // pertenece a la organización", pero tampoco debe filtrarse como 500:
      // Postgres rechaza el cast a uuid con un error crudo (22P02).
      if (
        error instanceof QueryFailedError &&
        error.driverError?.code === '22P02'
      ) {
        throw new ForbiddenException('No pertenecés a esa organización.');
      }
      throw error;
    }
    if (!membership) {
      throw new ForbiddenException('No pertenecés a esa organización.');
    }
    if (!membership.active) {
      throw new ForbiddenException(
        'Tu acceso a esta organización está deshabilitado.',
      );
    }

    request.organization = organization;
    request.membership = membership;
    return true;
  }
}
