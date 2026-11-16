import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { EventAttendance } from './entities/event-attendance.entity';
import { OrgEvent } from './entities/event.entity';
import { EventController } from './event.controller';
import { EventService } from './event.service';

// `forFeature` no se usa para inyectar repos (el service pide el manager a
// TenantContextService, nunca @InjectRepository: ver tenant.interceptor.ts):
// `autoLoadEntities` solo suma al DataSource las entidades que algún módulo
// registró con `forFeature`, así que sin esto TypeORM no conoce OrgEvent ni
// EventAttendance y cualquier repo.create()/find() sobre ellas explota con
// EntityMetadataNotFoundError. Mismo motivo por el que volunteer-type.module.ts
// lo hace pese a no usar @InjectRepository.
@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([OrgEvent, EventAttendance])],
  controllers: [EventController],
  providers: [EventService],
  exports: [EventService],
})
export class EventModule {}
