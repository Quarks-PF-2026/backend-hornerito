import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { MEMBER_MANAGER_ROLES } from '../../organization/entities/organization-membership.entity';
import { TenantGuard } from '../../tenant/tenant.guard';
import { ListMonetaryDonationsDto } from './dto/list-monetary-donations.dto';
import { RejectMonetaryDonationDto } from './dto/reject-monetary-donation.dto';
import { MonetaryDonationService } from './monetary-donation.service';

/**
 * Panel de donaciones económicas. Confirmar o rechazar mueve plata en la
 * contabilidad de la organización, así que se restringe a owner y admin — el
 * mismo criterio que la aprobación de solicitudes de voluntario, más estricto
 * que el registro de donaciones presenciales.
 */
@Controller('donations/monetary')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class MonetaryDonationController {
  constructor(private readonly donations: MonetaryDonationService) {}

  /** El historial lo ve cualquier miembro activo, igual que el presencial. */
  @Get()
  list(@Query() query: ListMonetaryDonationsDto) {
    return this.donations.list(query);
  }

  @Roles(...MEMBER_MANAGER_ROLES)
  @Post(':id/confirm')
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.donations.confirm(id, user.id);
  }

  @Roles(...MEMBER_MANAGER_ROLES)
  @Post(':id/reject')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectMonetaryDonationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.donations.reject(id, user.id, dto.rejectReason);
  }
}
