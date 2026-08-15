import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Organization } from '../organization/entities/organization.entity';
import { OrganizationMembership } from '../organization/entities/organization-membership.entity';
import { TenantContextService } from './tenant-context.service';
import { TenantGuard } from './tenant.guard';
import { TenantContextInterceptor } from './tenant.interceptor';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Organization, OrganizationMembership])],
  providers: [
    TenantContextService,
    TenantGuard,
    // Global: no hace nada si `TenantGuard` no dejó una organización en la
    // request, así que las rutas públicas y de auth no pagan nada.
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
  exports: [TypeOrmModule, TenantContextService, TenantGuard],
})
export class TenantModule {}
