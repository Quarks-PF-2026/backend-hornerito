import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { MailService } from '../mail/mail.service';
import { invitationMail } from '../mail/templates';
import type { IUserRepository } from '../auth/repositories/user-repository.interface';
import { USER_REPOSITORY } from '../auth/repositories/user-repository.interface';
import { InviteMemberDto } from './dto/invite-member.dto';
import { OrganizationInvitation } from './entities/organization-invitation.entity';
import {
  OrganizationMembership,
  OrganizationMembershipRole,
} from './entities/organization-membership.entity';
import type { IOrganizationInvitationRepository } from './repositories/organization-invitation-repository.interface';
import { ORGANIZATION_INVITATION_REPOSITORY } from './repositories/organization-invitation-repository.interface';
import type { IOrganizationMembershipRepository } from './repositories/organization-membership-repository.interface';
import { ORGANIZATION_MEMBERSHIP_REPOSITORY } from './repositories/organization-membership-repository.interface';
import type { IOrganizationRepository } from './repositories/organization-repository.interface';
import { ORGANIZATION_REPOSITORY } from './repositories/organization-repository.interface';

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const ROLE_LABEL: Record<OrganizationMembershipRole, string> = {
  [OrganizationMembershipRole.OWNER]: 'Dueño',
  [OrganizationMembershipRole.ADMIN]: 'Administrador',
  [OrganizationMembershipRole.COORDINATOR]: 'Coordinador',
  [OrganizationMembershipRole.VOLUNTEER]: 'Voluntario',
};

export interface MemberView {
  userId: string;
  name: string;
  email: string;
  role: OrganizationMembershipRole;
  active: boolean;
  createdAt: Date;
}

export interface InvitationView {
  id: string;
  email: string;
  role: OrganizationMembershipRole;
  expiresAt: Date;
  createdAt: Date;
}

@Injectable()
export class MemberService {
  constructor(
    @Inject(ORGANIZATION_MEMBERSHIP_REPOSITORY)
    private readonly membershipRepository: IOrganizationMembershipRepository,
    @Inject(ORGANIZATION_INVITATION_REPOSITORY)
    private readonly invitationRepository: IOrganizationInvitationRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: IOrganizationRepository,
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async list(organizationId: string): Promise<MemberView[]> {
    const memberships =
      await this.membershipRepository.findByOrganizationId(organizationId);
    const users = await this.userRepository.findByIds(
      memberships.map((membership) => membership.userId),
    );
    const usersById = new Map(users.map((user) => [user.id, user]));

    return memberships
      .filter((membership) => usersById.has(membership.userId))
      .map((membership) => {
        const user = usersById.get(membership.userId)!;
        return {
          userId: membership.userId,
          name: user.name,
          email: user.email,
          role: membership.role,
          active: membership.active,
          createdAt: membership.createdAt,
        };
      });
  }

  async changeRole(
    organizationId: string,
    actorUserId: string,
    targetUserId: string,
    role: OrganizationMembershipRole,
  ): Promise<MemberView> {
    const membership = await this.requireEditableMembership(
      organizationId,
      actorUserId,
      targetUserId,
    );
    membership.role = role;
    await this.membershipRepository.save(membership);
    return this.toView(membership);
  }

  async toggleActive(
    organizationId: string,
    actorUserId: string,
    targetUserId: string,
  ): Promise<MemberView> {
    const membership = await this.requireEditableMembership(
      organizationId,
      actorUserId,
      targetUserId,
    );
    membership.active = !membership.active;
    await this.membershipRepository.save(membership);
    return this.toView(membership);
  }

  async invite(
    organizationId: string,
    actorUserId: string,
    dto: InviteMemberDto,
  ): Promise<InvitationView> {
    const email = dto.email.trim().toLowerCase();

    const existingUser = await this.userRepository.findByEmail(email);
    if (existingUser) {
      const membership =
        await this.membershipRepository.findByUserAndOrganization(
          existingUser.id,
          organizationId,
        );
      if (membership) {
        throw new ConflictException(
          'Ese correo ya es miembro de la organización.',
        );
      }
    }

    const pending = await this.invitationRepository.findPendingByEmail(
      organizationId,
      email,
    );
    if (pending) {
      throw new ConflictException(
        'Ya hay una invitación pendiente para ese correo.',
      );
    }

    const organization =
      await this.organizationRepository.findById(organizationId);
    if (!organization) {
      throw new NotFoundException('La organización no existe.');
    }

    const invitation = await this.invitationRepository.create({
      organizationId,
      email,
      role: dto.role,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      acceptedAt: null,
      invitedByUserId: actorUserId,
    });

    const baseUrl = this.config.get<string>(
      'APP_BASE_URL',
      'http://localhost:4200',
    );
    await this.mail.send(
      invitationMail(
        email,
        organization.name,
        ROLE_LABEL[invitation.role],
        `${baseUrl}/invitacion?token=${invitation.token}`,
      ),
    );

    return this.toInvitationView(invitation);
  }

  async listInvitations(organizationId: string): Promise<InvitationView[]> {
    const invitations =
      await this.invitationRepository.findPendingByOrganization(organizationId);
    return invitations.map((invitation) => this.toInvitationView(invitation));
  }

  async cancelInvitation(
    organizationId: string,
    invitationId: string,
  ): Promise<void> {
    const invitation = await this.invitationRepository.findById(invitationId);
    if (!invitation || invitation.organizationId !== organizationId) {
      throw new NotFoundException('La invitación no existe.');
    }
    await this.invitationRepository.deleteById(invitationId);
  }

  private async requireEditableMembership(
    organizationId: string,
    actorUserId: string,
    targetUserId: string,
  ): Promise<OrganizationMembership> {
    if (actorUserId === targetUserId) {
      throw new ForbiddenException('No podés modificar tu propio acceso.');
    }

    const membership =
      await this.membershipRepository.findByUserAndOrganization(
        targetUserId,
        organizationId,
      );
    if (!membership) {
      throw new NotFoundException('El usuario no pertenece a la organización.');
    }
    if (membership.role === OrganizationMembershipRole.OWNER) {
      throw new ForbiddenException(
        'No se puede modificar al dueño de la organización.',
      );
    }
    return membership;
  }

  private async toView(
    membership: OrganizationMembership,
  ): Promise<MemberView> {
    const [user] = await this.userRepository.findByIds([membership.userId]);
    return {
      userId: membership.userId,
      name: user?.name ?? '',
      email: user?.email ?? '',
      role: membership.role,
      active: membership.active,
      createdAt: membership.createdAt,
    };
  }

  private toInvitationView(invitation: OrganizationInvitation): InvitationView {
    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    };
  }
}
