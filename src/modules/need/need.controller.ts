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
import { CreateNeedDto } from './dto/create-need.dto';
import { UpdateNeedDto } from './dto/update-need.dto';
import { UpdateProgressDto } from './dto/update-progress.dto';
import { NeedService } from './need.service';

@Controller('needs')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class NeedController {
  constructor(private readonly needService: NeedService) {}

  @Get()
  listMine() {
    return this.needService.listMine();
  }

  @Roles(...CONTENT_WRITER_ROLES)
  @Post()
  create(@Body() dto: CreateNeedDto) {
    return this.needService.create(dto);
  }

  @Roles(...CONTENT_WRITER_ROLES)
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateNeedDto) {
    return this.needService.update(id, dto);
  }

  @Roles(...CONTENT_WRITER_ROLES)
  @Patch(':id/progress')
  updateProgress(@Param('id') id: string, @Body() dto: UpdateProgressDto) {
    return this.needService.updateProgress(id, dto);
  }

  @Roles(...CONTENT_WRITER_ROLES)
  @Patch(':id/close')
  close(@Param('id') id: string) {
    return this.needService.close(id);
  }
}
