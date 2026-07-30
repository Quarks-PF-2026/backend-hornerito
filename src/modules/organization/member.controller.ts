import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { TenantGuard } from '../tenant/tenant.guard';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { MEMBER_MANAGER_ROLES } from './entities/organization-membership.entity';
import { MemberService } from './member.service';

@Controller('organization/members')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(...MEMBER_MANAGER_ROLES)
export class MemberController {
  constructor(private readonly memberService: MemberService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.memberService.list(user.orgId!);
  }

  @Get('invitations')
  listInvitations(@CurrentUser() user: AuthenticatedUser) {
    return this.memberService.listInvitations(user.orgId!);
  }

  @Post('invitations')
  invite(@CurrentUser() user: AuthenticatedUser, @Body() dto: InviteMemberDto) {
    return this.memberService.invite(user.orgId!, user.id, dto);
  }

  @Delete('invitations/:id')
  @HttpCode(204)
  cancelInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.memberService.cancelInvitation(user.orgId!, id);
  }

  @Patch(':userId/role')
  changeRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.memberService.changeRole(
      user.orgId!,
      user.id,
      userId,
      dto.role,
    );
  }

  @Patch(':userId/toggle')
  toggle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
  ) {
    return this.memberService.toggleActive(user.orgId!, user.id, userId);
  }
}
