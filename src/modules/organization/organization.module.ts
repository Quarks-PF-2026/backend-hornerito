import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Organization } from './entities/organization.entity';
import { OrganizationMembership } from './entities/organization-membership.entity';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';
import { ORGANIZATION_REPOSITORY } from './repositories/organization-repository.interface';
import { TypeOrmOrganizationRepository } from './repositories/typeorm-organization.repository';
import { ORGANIZATION_MEMBERSHIP_REPOSITORY } from './repositories/organization-membership-repository.interface';
import { TypeOrmOrganizationMembershipRepository } from './repositories/typeorm-organization-membership.repository';
import { TenantProvisioningService } from './tenant/tenant-provisioning.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([Organization, OrganizationMembership]),
  ],
  controllers: [OrganizationController],
  providers: [
    OrganizationService,
    TenantProvisioningService,
    {
      provide: ORGANIZATION_REPOSITORY,
      useClass: TypeOrmOrganizationRepository,
    },
    {
      provide: ORGANIZATION_MEMBERSHIP_REPOSITORY,
      useClass: TypeOrmOrganizationMembershipRepository,
    },
  ],
})
export class OrganizationModule {}
