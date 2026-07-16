import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../tenant/tenant.guard';
import { CreateSupplyDto } from './dto/create-supply.dto';
import { UpdateSupplyDto } from './dto/update-supply.dto';
import { SupplyService } from './supply.service';

@Controller('supplies')
@UseGuards(JwtAuthGuard, TenantGuard)
export class SupplyController {
  constructor(private readonly supplyService: SupplyService) {}

  @Get()
  listMine() {
    return this.supplyService.listMine();
  }

  @Post()
  create(@Body() dto: CreateSupplyDto) {
    return this.supplyService.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSupplyDto) {
    return this.supplyService.update(id, dto);
  }

  @Patch(':id/toggle')
  toggle(@Param('id') id: string) {
    return this.supplyService.toggle(id);
  }
}
