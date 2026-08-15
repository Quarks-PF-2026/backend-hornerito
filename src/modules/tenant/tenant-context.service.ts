import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { EntityManager } from 'typeorm';
import type { TenantScopedRequest } from './tenant-request';

/**
 * Usar en servicios de módulos tenant-scoped en vez de `@InjectRepository` fijo:
 * inyectar este servicio, pedir `getManager()` y armar el repository al vuelo
 * con `manager.getRepository(MiEntity)`.
 *
 * El manager que devuelve está atado a la conexión que preparó
 * `TenantContextInterceptor`: rol `hornerito_app` y `app.current_org` seteada,
 * o sea con RLS activo. Requiere que `TenantGuard` haya corrido antes en la
 * cadena de guards del controller.
 *
 * RLS es la red de seguridad, no el filtro: los servicios igual pasan
 * `organizationId` explícito en cada query.
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantContextService {
  constructor(@Inject(REQUEST) private readonly request: TenantScopedRequest) {}

  get organizationId(): string {
    const orgId = this.request.organization?.id ?? this.request.user?.orgId;
    if (!orgId) {
      throw new Error(
        'TenantContextService usado fuera de un request con TenantGuard aplicado.',
      );
    }
    return orgId;
  }

  getManager(): EntityManager {
    const queryRunner = this.request.tenantQueryRunner;
    if (!queryRunner) {
      throw new Error(
        'TenantContextService usado sin TenantContextInterceptor: la conexión no tiene el tenant seteado.',
      );
    }
    return queryRunner.manager;
  }
}
