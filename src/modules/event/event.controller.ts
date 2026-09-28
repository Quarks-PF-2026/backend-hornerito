import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CONTENT_WRITER_ROLES } from '../organization/entities/organization-membership.entity';
import { TenantGuard } from '../tenant/tenant.guard';
import { CreateEventDto } from './dto/create-event.dto';
import { OccurrencesQueryDto } from './dto/occurrences-query.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { EventService } from './event.service';

@Controller('events')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class EventController {
  constructor(private readonly eventService: EventService) {}

  @Get()
  listMine() {
    return this.eventService.listMine();
  }

  @Roles(...CONTENT_WRITER_ROLES)
  @Post()
  create(@Body() dto: CreateEventDto) {
    return this.eventService.create(dto);
  }

  @Roles(...CONTENT_WRITER_ROLES)
  @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEventDto) {
    return this.eventService.update(id, dto);
  }

  @Roles(...CONTENT_WRITER_ROLES)
  @Patch(':id/deactivate')
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.eventService.deactivate(id);
  }

  @Get(':id/occurrences')
  occurrences(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: OccurrencesQueryDto,
  ) {
    return this.eventService.occurrences(id, query.from, query.to);
  }

  // Sin @Roles(): cualquier miembro activo carga el conteo de su turno.
  @Put(':id/attendance/:date')
  setAttendance(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('date') date: string,
    @Body() dto: UpdateAttendanceDto,
  ) {
    return this.eventService.setAttendance(id, date, dto);
  }
}
