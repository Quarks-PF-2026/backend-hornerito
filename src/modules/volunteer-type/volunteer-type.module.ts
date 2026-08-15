import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { VolunteerType } from './entities/volunteer-type.entity';
import { VolunteerTypeController } from './volunteer-type.controller';
import { VolunteerTypeService } from './volunteer-type.service';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([VolunteerType])],
  controllers: [VolunteerTypeController],
  providers: [VolunteerTypeService],
})
export class VolunteerTypeModule {}
