import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Organization } from '../organization/entities/organization.entity';
import { OrganizationMembership } from '../organization/entities/organization-membership.entity';
import { TenantConnectionService } from './tenant-connection.service';
import { TenantContextService } from './tenant-context.service';
import { TenantGuard } from './tenant.guard';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Organization, OrganizationMembership])],
  providers: [TenantConnectionService, TenantContextService, TenantGuard],
  exports: [
    TypeOrmModule,
    TenantConnectionService,
    TenantContextService,
    TenantGuard,
  ],
})
export class TenantModule {}
