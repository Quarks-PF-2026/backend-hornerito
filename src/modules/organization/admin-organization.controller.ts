import { Body, Controller, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';
import { RejectOrganizationDto } from './dto/reject-organization.dto';
import { OrganizationService } from './organization.service';

/**
 * Panel de un platform admin (ver PlatformAdminGuard) para validar/rechazar
 * organizaciones — QK-13, CP-13-04 y CP-13-05.
 */
@Controller('admin/organizations')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class AdminOrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

  @Patch(':id/validate')
  validate(@Param('id', ParseUUIDPipe) id: string) {
    return this.organizationService.validate(id);
  }

  @Patch(':id/reject')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectOrganizationDto,
  ) {
    return this.organizationService.reject(id, dto.reason);
  }
}