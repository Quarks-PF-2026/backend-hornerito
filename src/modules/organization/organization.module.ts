import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AdminOrganizationController } from './admin-organization.controller';
import { Organization } from './entities/organization.entity';
import { OrganizationInvitation } from './entities/organization-invitation.entity';
import { OrganizationMembership } from './entities/organization-membership.entity';
import { InvitationController } from './invitation.controller';
import { InvitationService } from './invitation.service';
import { MemberController } from './member.controller';
import { MemberService } from './member.service';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';
import { ORGANIZATION_REPOSITORY } from './repositories/organization-repository.interface';
import { TypeOrmOrganizationRepository } from './repositories/typeorm-organization.repository';
import { ORGANIZATION_MEMBERSHIP_REPOSITORY } from './repositories/organization-membership-repository.interface';
import { TypeOrmOrganizationMembershipRepository } from './repositories/typeorm-organization-membership.repository';
import { ORGANIZATION_INVITATION_REPOSITORY } from './repositories/organization-invitation-repository.interface';
import { TypeOrmOrganizationInvitationRepository } from './repositories/typeorm-organization-invitation.repository';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      Organization,
      OrganizationMembership,
      OrganizationInvitation,
    ]),
  ],
  controllers: [
    OrganizationController,
    MemberController,
    InvitationController,
    AdminOrganizationController,
  ],
  providers: [
    OrganizationService,
    MemberService,
    InvitationService,
    {
      provide: ORGANIZATION_REPOSITORY,
      useClass: TypeOrmOrganizationRepository,
    },
    {
      provide: ORGANIZATION_MEMBERSHIP_REPOSITORY,
      useClass: TypeOrmOrganizationMembershipRepository,
    },
    {
      provide: ORGANIZATION_INVITATION_REPOSITORY,
      useClass: TypeOrmOrganizationInvitationRepository,
    },
  ],
  // Lo consume VolunteeringModule al aprobar una solicitud de voluntario.
  exports: [MemberService],
})
export class OrganizationModule {}
