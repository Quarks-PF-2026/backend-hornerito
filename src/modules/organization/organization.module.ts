import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Organization } from './entities/organization.entity';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';
import { ORGANIZATION_REPOSITORY } from './repositories/organization-repository.interface';
import { TypeOrmOrganizationRepository } from './repositories/typeorm-organization.repository';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([Organization])],
  controllers: [OrganizationController],
  providers: [
    OrganizationService,
    {
      provide: ORGANIZATION_REPOSITORY,
      useClass: TypeOrmOrganizationRepository,
    },
  ],
})
export class OrganizationModule {}
