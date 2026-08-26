import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { User } from '../auth/entities/user.entity';
import { OrganizationModule } from '../organization/organization.module';
import { Organization } from '../organization/entities/organization.entity';
import { OrganizationMembership } from '../organization/entities/organization-membership.entity';
import { VolunteerType } from '../volunteer-type/entities/volunteer-type.entity';
import { PublicVolunteerRequestController } from './public-volunteer-request.controller';
import { VolunteerApplication } from './entities/volunteer-application.entity';
import { VolunteerOpportunity } from './entities/volunteer-opportunity.entity';
import { VolunteerRequest } from './entities/volunteer-request.entity';
import { VolunteerRequestService } from './volunteer-request.service';
import { VolunteeringController } from './volunteering.controller';
import { VolunteeringService } from './volunteering.service';

@Module({
  imports: [
    AuthModule,
    // Por `MemberService`: aprobar una solicitud emite una invitación, no crea
    // la membresía a mano. No hay ciclo — OrganizationModule importa
    // AuthModule, no este módulo.
    OrganizationModule,
    TypeOrmModule.forFeature([
      VolunteerOpportunity,
      VolunteerApplication,
      VolunteerRequest,
      // Las lee la vía anónima por la conexión owner, sin tenant seteado.
      Organization,
      OrganizationMembership,
      VolunteerType,
      User,
    ]),
  ],
  controllers: [VolunteeringController, PublicVolunteerRequestController],
  providers: [VolunteeringService, VolunteerRequestService],
})
export class VolunteeringModule {}
