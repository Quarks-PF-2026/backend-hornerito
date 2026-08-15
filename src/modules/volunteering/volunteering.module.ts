import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { VolunteerApplication } from './entities/volunteer-application.entity';
import { VolunteerOpportunity } from './entities/volunteer-opportunity.entity';
import { VolunteeringController } from './volunteering.controller';
import { VolunteeringService } from './volunteering.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([VolunteerOpportunity, VolunteerApplication]),
  ],
  controllers: [VolunteeringController],
  providers: [VolunteeringService],
})
export class VolunteeringModule {}
