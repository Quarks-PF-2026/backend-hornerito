import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CONTENT_WRITER_ROLES } from '../organization/entities/organization-membership.entity';
import { TenantGuard } from '../tenant/tenant.guard';
import { DonationService } from './donation.service';
import { CreateDonationDto } from './dto/create-donation.dto';
import { ListDonationsDto } from './dto/list-donations.dto';

@Controller('donations')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class DonationController {
  constructor(private readonly donationService: DonationService) {}

  /** El historial lo ve cualquier miembro activo, igual que las necesidades. */
  @Get()
  listMine(@Query() query: ListDonationsDto) {
    return this.donationService.listMine(query);
  }

  @Roles(...CONTENT_WRITER_ROLES)
  @Post()
  create(@Body() dto: CreateDonationDto) {
    return this.donationService.create(dto);
  }
}
