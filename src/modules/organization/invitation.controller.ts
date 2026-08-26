import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { InvitationService } from './invitation.service';

// Público: el invitado todavía no tiene sesión. El token de la invitación es
// la credencial.
@Controller('invitations')
export class InvitationController {
  constructor(private readonly invitationService: InvitationService) {}

  @Get(':token')
  preview(@Param('token') token: string) {
    return this.invitationService.preview(token);
  }

  @Post(':token/accept')
  accept(@Param('token') token: string, @Body() dto: AcceptInvitationDto) {
    return this.invitationService.accept(token, dto);
  }
}
