import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { EntityManager } from 'typeorm';
import { Organization } from '../organization/entities/organization.entity';
import { TenantConnectionService } from './tenant-connection.service';

interface TenantRequest {
  organization?: Organization;
  user?: { orgId?: string };
}

/**
 * Usar en servicios de módulos tenant-scoped en vez de `@InjectRepository` fijo:
 * inyectar este servicio, pedir `getManager()` y armar el repository al vuelo
 * con `manager.getRepository(MiEntity)`. Requiere que `TenantGuard` haya corrido
 * antes en la cadena de guards del controller.
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantContextService {
  constructor(
    @Inject(REQUEST) private readonly request: TenantRequest,
    private readonly tenantConnectionService: TenantConnectionService,
  ) {}

  private get organizationId(): string {
    const orgId = this.request.organization?.id ?? this.request.user?.orgId;
    if (!orgId) {
      throw new Error(
        'TenantContextService usado fuera de un request con TenantGuard aplicado.',
      );
    }
    return orgId;
  }

  async getManager(): Promise<EntityManager> {
    const dataSource = await this.tenantConnectionService.getDataSource(
      this.organizationId,
    );
    return dataSource.manager;
  }
}
