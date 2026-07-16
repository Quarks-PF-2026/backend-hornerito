import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Organization,
  OrganizationStatus,
} from '../organization/entities/organization.entity';

interface TenantGuardedRequest {
  user?: { orgId?: string };
  organization?: Organization;
}

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
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

    request.organization = organization;
    return true;
  }
}
