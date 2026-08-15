import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CONTENT_WRITER_ROLES } from '../organization/entities/organization-membership.entity';
import { TenantGuard } from '../tenant/tenant.guard';
import { CreateVolunteerTypeDto } from './dto/create-volunteer-type.dto';
import { UpdateVolunteerTypeDto } from './dto/update-volunteer-type.dto';
import { VolunteerTypeService } from './volunteer-type.service';

@Controller('volunteer-types')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class VolunteerTypeController {
  constructor(private readonly volunteerTypeService: VolunteerTypeService) {}

  @Get()
  listMine() {
    return this.volunteerTypeService.listMine();
  }

  @Roles(...CONTENT_WRITER_ROLES)
  @Post()
  create(@Body() dto: CreateVolunteerTypeDto) {
    return this.volunteerTypeService.create(dto);
  }

  @Roles(...CONTENT_WRITER_ROLES)
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateVolunteerTypeDto) {
    return this.volunteerTypeService.update(id, dto);
  }

  @Roles(...CONTENT_WRITER_ROLES)
  @Patch(':id/toggle')
  toggle(@Param('id') id: string) {
    return this.volunteerTypeService.toggle(id);
  }
}
