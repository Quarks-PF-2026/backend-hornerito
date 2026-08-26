import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CONTENT_WRITER_ROLES } from '../organization/entities/organization-membership.entity';
import { TenantGuard } from '../tenant/tenant.guard';
import { CreateOpportunityDto } from './dto/create-opportunity.dto';
import { RejectVolunteerRequestDto } from './dto/reject-volunteer-request.dto';
import { UpdateOpportunityDto } from './dto/update-opportunity.dto';
import { VolunteerRequestService } from './volunteer-request.service';
import { VolunteeringService } from './volunteering.service';

@Controller('volunteering')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class VolunteeringController {
  constructor(
    private readonly volunteeringService: VolunteeringService,
    private readonly requestService: VolunteerRequestService,
  ) {}

  /** Sin `@Roles`: cualquier miembro activo ve las oportunidades de su comedor. */
  @Get('opportunities')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.volunteeringService.list(user.id);
  }

  @Roles(...CONTENT_WRITER_ROLES)
  @Post('opportunities')
  create(@Body() dto: CreateOpportunityDto) {
    return this.volunteeringService.create(dto);
  }

  @Roles(...CONTENT_WRITER_ROLES)
  @Put('opportunities/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOpportunityDto,
  ) {
    return this.volunteeringService.update(id, dto);
  }

  @Roles(...CONTENT_WRITER_ROLES)
  @Patch('opportunities/:id/close')
  close(@Param('id', ParseUUIDPipe) id: string) {
    return this.volunteeringService.close(id);
  }

  @Roles(...CONTENT_WRITER_ROLES)
  @Patch('opportunities/:id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.volunteeringService.cancel(id);
  }

  /** También sin `@Roles`: el caso típico es el rol `voluntario`, pero
   * cualquier miembro activo puede anotarse a una actividad. */
  @Post('opportunities/:id/applications')
  apply(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.volunteeringService.apply(id, user.id);
  }

  @Roles(...CONTENT_WRITER_ROLES)
  @Get('opportunities/:id/applications')
  listApplications(@Param('id', ParseUUIDPipe) id: string) {
    return this.volunteeringService.listApplications(id);
  }

  @Roles(...CONTENT_WRITER_ROLES)
  @Patch('applications/:id/accept')
  accept(@Param('id', ParseUUIDPipe) id: string) {
    return this.volunteeringService.accept(id);
  }

  @Roles(...CONTENT_WRITER_ROLES)
  @Patch('applications/:id/reject')
  reject(@Param('id', ParseUUIDPipe) id: string) {
    return this.volunteeringService.reject(id);
  }

  /**
   * Solicitudes que llegaron desde la ficha pública (QK-16). Mismos roles que
   * el resto del voluntariado: el coordinador es quien lo gestiona.
   */
  @Roles(...CONTENT_WRITER_ROLES)
  @Get('requests')
  listRequests() {
    return this.requestService.list();
  }

  @Roles(...CONTENT_WRITER_ROLES)
  @Patch('requests/:id/approve')
  approveRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.requestService.approve(id, user.id);
  }

  @Roles(...CONTENT_WRITER_ROLES)
  @Patch('requests/:id/reject')
  rejectRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RejectVolunteerRequestDto,
  ) {
    return this.requestService.reject(id, user.id, dto.reason);
  }
}
