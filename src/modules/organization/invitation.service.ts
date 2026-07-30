import {
  BadRequestException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService, LoginResult } from '../auth/auth.service';
import type { IUserRepository } from '../auth/repositories/user-repository.interface';
import { USER_REPOSITORY } from '../auth/repositories/user-repository.interface';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { OrganizationInvitation } from './entities/organization-invitation.entity';
import type { IOrganizationInvitationRepository } from './repositories/organization-invitation-repository.interface';
import { ORGANIZATION_INVITATION_REPOSITORY } from './repositories/organization-invitation-repository.interface';
import type { IOrganizationMembershipRepository } from './repositories/organization-membership-repository.interface';
import { ORGANIZATION_MEMBERSHIP_REPOSITORY } from './repositories/organization-membership-repository.interface';
import type { IOrganizationRepository } from './repositories/organization-repository.interface';
import { ORGANIZATION_REPOSITORY } from './repositories/organization-repository.interface';

const PASSWORD_SALT_ROUNDS = 10;

export interface InvitationPreview {
  organizationName: string;
  email: string;
  role: string;
  userExists: boolean;
}

@Injectable()
export class InvitationService {
  constructor(
    @Inject(ORGANIZATION_INVITATION_REPOSITORY)
    private readonly invitationRepository: IOrganizationInvitationRepository,
    @Inject(ORGANIZATION_MEMBERSHIP_REPOSITORY)
    private readonly membershipRepository: IOrganizationMembershipRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: IOrganizationRepository,
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
    private readonly authService: AuthService,
  ) {}

  async preview(token: string): Promise<InvitationPreview> {
    const invitation = await this.requireValidInvitation(token);
    const organization = await this.organizationRepository.findById(
      invitation.organizationId,
    );
    const user = await this.userRepository.findByEmail(invitation.email);

    return {
      organizationName: organization?.name ?? '',
      email: invitation.email,
      role: invitation.role,
      userExists: Boolean(user),
    };
  }

  async accept(
    token: string,
    dto: AcceptInvitationDto,
  ): Promise<LoginResult & { organizationId: string }> {
    const invitation = await this.requireValidInvitation(token);

    let user = await this.userRepository.findByEmail(invitation.email);
    if (!user) {
      if (!dto.name || !dto.password) {
        throw new BadRequestException(
          'Ingresá tu nombre y una contraseña para crear la cuenta.',
        );
      }
      user = await this.userRepository.create({
        name: dto.name,
        email: invitation.email,
        passwordHash: await bcrypt.hash(dto.password, PASSWORD_SALT_ROUNDS),
        emailVerified: true,
        termsAcceptedAt: new Date(),
      });
    }

    const existing = await this.membershipRepository.findByUserAndOrganization(
      user.id,
      invitation.organizationId,
    );
    if (existing) {
      // Reactivar y reasignar el rol es lo esperable al re-invitar a alguien
      // que había sido dado de baja.
      existing.role = invitation.role;
      existing.active = true;
      await this.membershipRepository.save(existing);
    } else {
      await this.membershipRepository.create({
        userId: user.id,
        organizationId: invitation.organizationId,
        role: invitation.role,
        active: true,
      });
    }

    invitation.acceptedAt = new Date();
    await this.invitationRepository.save(invitation);

    return {
      ...this.authService.issueAccessToken(
        user,
        invitation.organizationId,
        invitation.role,
      ),
      organizationId: invitation.organizationId,
    };
  }

  private async requireValidInvitation(
    token: string,
  ): Promise<OrganizationInvitation> {
    const invitation =
      await this.invitationRepository.findPendingByToken(token);
    if (!invitation) {
      throw new NotFoundException('La invitación no existe o ya fue usada.');
    }
    if (invitation.expiresAt.getTime() < Date.now()) {
      throw new GoneException('La invitación venció.');
    }
    return invitation;
  }
}
