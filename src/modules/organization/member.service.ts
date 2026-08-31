import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { In, IsNull, Repository } from 'typeorm';
import { MailService } from '../mail/mail.service';
import { invitationMail } from '../mail/templates';
import { User } from '../auth/entities/user.entity';
import { TenantContextService } from '../tenant/tenant-context.service';
import { InviteMemberDto } from './dto/invite-member.dto';
import { OrganizationInvitation } from './entities/organization-invitation.entity';
import {
  OrganizationMembership,
  OrganizationMembershipRole,
} from './entities/organization-membership.entity';
import { Organization } from './entities/organization.entity';

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

/**
 * Gestión de miembros e invitaciones de una organización (QK-15).
 *
 * Es 100% tenant-scoped: `MemberController` lleva `TenantGuard`, y su único
 * otro consumidor —`VolunteerRequestService.approve`— también entra por ahí.
 * Por eso pide el manager a `TenantContextService` en vez de inyectar los
 * repositorios por token, que es lo que hacía antes: esos repositorios van por
 * la conexión de owner, y pedir una segunda conexión mientras
 * `TenantContextInterceptor` retiene la del tenant deadlockea la request
 * entera contra el pool.
 *
 * Los puertos `IOrganizationMembershipRepository` y compañía siguen existiendo
 * para sus consumidores que corren fuera del tenant (`auth`, `invitation`,
 * `organization`, `platform-admin.guard`). Acá las queries eran triviales, así
 * que ir por el manager sale más barato que sostener un adaptador bimodal.
 *
 * Efecto colateral buscado: estas lecturas y escrituras ahora viajan bajo el
 * rol `hornerito_app` y con RLS activo, que es lo que la migración
 * `ColumnBasedTenancy` ya había preparado para este módulo.
 */
@Injectable()
export class MemberService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async list(organizationId: string, search?: string): Promise<MemberView[]> {
    const memberships = await this.memberships().find({
      where: { organizationId },
      order: { createdAt: 'ASC' },
    });
    const users = await this.findUsersByIds(
      memberships.map((membership) => membership.userId),
    );
    const usersById = new Map(users.map((user) => [user.id, user]));

    const views = memberships
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

    const term = search?.trim().toLowerCase();
    if (!term) {
      return views;
    }
    return views.filter(
      (view) =>
        view.name.toLowerCase().includes(term) ||
        view.email.toLowerCase().includes(term) ||
        view.role.toLowerCase().includes(term) ||
        ROLE_LABEL[view.role].toLowerCase().includes(term),
    );
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
    await this.memberships().save(membership);
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
    await this.memberships().save(membership);
    return this.toView(membership);
  }

  async invite(
    organizationId: string,
    actorUserId: string,
    dto: InviteMemberDto,
  ): Promise<InvitationView> {
    const email = dto.email.trim().toLowerCase();

    const existingUser = await this.users().findOneBy({ email });
    if (existingUser) {
      const membership = await this.memberships().findOneBy({
        userId: existingUser.id,
        organizationId,
      });
      if (membership) {
        throw new ConflictException(
          'Ese correo ya es miembro de la organización.',
        );
      }
    }

    const pending = await this.invitations().findOneBy({
      organizationId,
      email,
      acceptedAt: IsNull(),
    });
    if (pending) {
      throw new ConflictException(
        'Ya hay una invitación pendiente para ese correo.',
      );
    }

    const organization = await this.organizations().findOneBy({
      id: organizationId,
    });
    if (!organization) {
      throw new NotFoundException('La organización no existe.');
    }

    const invitations = this.invitations();
    const invitation = await invitations.save(
      invitations.create({
        organizationId,
        email,
        role: dto.role,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        acceptedAt: null,
        invitedByUserId: actorUserId,
      }),
    );

    const baseUrl = this.config.get<string>(
      'APP_BASE_URL',
      'http://localhost:4200',
    );
    // ponytail: el envío del mail es I/O de red con la conexión del tenant
    // tomada, y desde `approve` además con el lock pesimista de la actividad
    // puesto: un SMTP lento alarga la sección crítica y bloquea a quien esté
    // aprobando en paralelo. Es el comportamiento que ya había; el techo se
    // sube sacando el envío a un job fuera de la transacción, no acá.
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
    const invitations = await this.invitations().find({
      where: { organizationId, acceptedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    return invitations.map((invitation) => this.toInvitationView(invitation));
  }

  async cancelInvitation(
    organizationId: string,
    invitationId: string,
  ): Promise<void> {
    const invitation = await this.invitations().findOneBy({ id: invitationId });
    if (!invitation || invitation.organizationId !== organizationId) {
      throw new NotFoundException('La invitación no existe.');
    }
    await this.invitations().delete({ id: invitationId });
  }

  private async requireEditableMembership(
    organizationId: string,
    actorUserId: string,
    targetUserId: string,
  ): Promise<OrganizationMembership> {
    if (actorUserId === targetUserId) {
      throw new ForbiddenException('No podés modificar tu propio acceso.');
    }

    const membership = await this.memberships().findOneBy({
      userId: targetUserId,
      organizationId,
    });
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
    const [user] = await this.findUsersByIds([membership.userId]);
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

  private findUsersByIds(ids: string[]): Promise<User[]> {
    return ids.length
      ? this.users().findBy({ id: In(ids) })
      : Promise.resolve([]);
  }

  private memberships(): Repository<OrganizationMembership> {
    return this.tenantContext
      .getManager()
      .getRepository(OrganizationMembership);
  }

  private invitations(): Repository<OrganizationInvitation> {
    return this.tenantContext
      .getManager()
      .getRepository(OrganizationInvitation);
  }

  private organizations(): Repository<Organization> {
    return this.tenantContext.getManager().getRepository(Organization);
  }

  private users(): Repository<User> {
    return this.tenantContext.getManager().getRepository(User);
  }
}
