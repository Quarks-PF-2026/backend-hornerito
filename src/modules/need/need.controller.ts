import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../tenant/tenant.guard';
import { CreateNeedDto } from './dto/create-need.dto';
import { UpdateNeedDto } from './dto/update-need.dto';
import { UpdateProgressDto } from './dto/update-progress.dto';
import { NeedService } from './need.service';

@Controller('needs')
@UseGuards(JwtAuthGuard, TenantGuard)
export class NeedController {
  constructor(private readonly needService: NeedService) {}

  @Get()
  listMine() {
    return this.needService.listMine();
  }

  @Post()
  create(@Body() dto: CreateNeedDto) {
    return this.needService.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateNeedDto) {
    return this.needService.update(id, dto);
  }

  @Patch(':id/progress')
  updateProgress(@Param('id') id: string, @Body() dto: UpdateProgressDto) {
    return this.needService.updateProgress(id, dto);
  }

  @Patch(':id/close')
  close(@Param('id') id: string) {
    return this.needService.close(id);
  }
}
