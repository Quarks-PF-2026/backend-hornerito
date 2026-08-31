import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { MailService } from '../mail/mail.service';
import {
  volunteerRequestNoticeMail,
  volunteerRequestReceivedMail,
  volunteerRequestRejectedMail,
} from '../mail/templates';
import { MemberService } from '../organization/member.service';
import {
  MEMBER_MANAGER_ROLES,
  OrganizationMembership,
  OrganizationMembershipRole,
} from '../organization/entities/organization-membership.entity';
import {
  Organization,
  OrganizationStatus,
} from '../organization/entities/organization.entity';
import { TenantContextService } from '../tenant/tenant-context.service';
import { VolunteerType } from '../volunteer-type/entities/volunteer-type.entity';
import { CreateVolunteerRequestDto } from './dto/create-volunteer-request.dto';
import {
  OpportunityStatus,
  VolunteerOpportunity,
  isOpportunityOpen,
} from './entities/volunteer-opportunity.entity';
import {
  VolunteerRequest,
  VolunteerRequestStatus,
} from './entities/volunteer-request.entity';

export interface VolunteerRequestView {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  message: string | null;
  status: VolunteerRequestStatus;
  rejectReason: string | null;
  opportunityId: string | null;
  opportunityTitle: string | null;
  volunteerTypeId: string | null;
  volunteerTypeName: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}

/**
 * Validar Voluntario (QK-16).
 *
 * Conviven dos vías de acceso a datos a propósito:
 *
 * - `submit` la llama un visitante **sin sesión**, así que no hay tenant que
 *   setear: usa los repositorios inyectados, que van por la conexión owner.
 *   Es la misma postura de `PublicService`, y el recorte lo hace este service
 *   filtrando por la organización `validated` de la URL.
 * - el panel (`list`, `approve`, `reject`) entra autenticado, con `TenantGuard`
 *   ya corrido, así que usa `TenantContextService` y viaja con RLS activo.
 *
 * `TenantContextService` es `Scope.REQUEST` pero solo falla al invocar
 * `organizationId`/`getManager()`, que la vía anónima nunca toca.
 */
@Injectable()
export class VolunteerRequestService {
  private readonly logger = new Logger(VolunteerRequestService.name);

  constructor(
    @InjectRepository(VolunteerRequest)
    private readonly requests: Repository<VolunteerRequest>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    @InjectRepository(VolunteerOpportunity)
    private readonly opportunities: Repository<VolunteerOpportunity>,
    @InjectRepository(VolunteerType)
    private readonly volunteerTypes: Repository<VolunteerType>,
    @InjectRepository(OrganizationMembership)
    private readonly memberships: Repository<OrganizationMembership>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly tenantContext: TenantContextService,
    private readonly memberService: MemberService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /** Vía anónima: alguien se ofrece desde la ficha pública. */
  async submit(
    organizationId: string,
    dto: CreateVolunteerRequestDto,
  ): Promise<{ id: string; status: VolunteerRequestStatus }> {
    if (dto.opportunityId && dto.volunteerTypeId) {
      throw new BadRequestException(
        'Elegí una actividad concreta o un tipo de voluntariado, no ambos.',
      );
    }

    const organization = await this.organizations.findOneBy({
      id: organizationId,
    });
    // Mismo mensaje que PublicService: desde afuera no se distingue una
    // organización inexistente de una que todavía no fue validada.
    if (!organization || organization.status !== OrganizationStatus.VALIDATED) {
      throw new NotFoundException('La organización no existe.');
    }

    let opportunity: VolunteerOpportunity | null = null;
    let volunteerTypeId: string | null = null;

    if (dto.opportunityId) {
      opportunity = await this.opportunities.findOneBy({
        id: dto.opportunityId,
        organizationId,
      });
      if (!opportunity) {
        throw new NotFoundException('La actividad no existe.');
      }
      if (!isOpportunityOpen(opportunity)) {
        throw new ConflictException('La actividad ya no acepta postulaciones.');
      }
      // El CHECK de la tabla no deja tener los dos: la clasificación de una
      // postulación a una actividad ya la lleva la actividad.
    } else if (dto.volunteerTypeId) {
      const type = await this.volunteerTypes.findOneBy({
        id: dto.volunteerTypeId,
        organizationId,
        active: true,
      });
      if (!type) {
        throw new NotFoundException('El tipo de voluntariado no existe.');
      }
      volunteerTypeId = type.id;
    }

    const saved = await this.requests.save(
      this.requests.create({
        organizationId,
        opportunityId: opportunity?.id ?? null,
        volunteerTypeId,
        name: dto.name.trim(),
        email: dto.email.trim().toLowerCase(),
        phone: dto.phone?.trim() || null,
        message: dto.message?.trim() || null,
        status: VolunteerRequestStatus.PENDING,
      }),
    );

    await this.notifySubmission(
      organization,
      saved,
      opportunity?.title ?? null,
    );

    // Nada más: devolver la fila entera filtraría organizationId e ids internos.
    return { id: saved.id, status: saved.status };
  }

  async list(): Promise<VolunteerRequestView[]> {
    const organizationId = this.orgId;
    const requests = await this.repo().find({
      where: { organizationId },
      order: { status: 'ASC', createdAt: 'DESC' },
    });
    return this.toViews(requests);
  }

  /**
   * El cupo se reserva acá, con lock pesimista sobre la actividad, igual que
   * `VolunteeringService.accept`: dos gestores aprobando a la vez no pueden
   * pasarse de `capacity`.
   *
   * `MemberService.invite` va **dentro** de la transacción y ahora sí es
   * atómico con ella: desde que pide su manager a `TenantContextService`
   * escribe por la misma conexión, y `EntityManager.transaction` reusa el
   * `queryRunner` que ya está en transacción en vez de tomar otro. Así el cupo
   * y la invitación se confirman o se revierten juntos, y desaparece la
   * invitación huérfana que dejaba el commit fallido cuando `invite` viajaba
   * por la conexión de owner.
   *
   * El mail de invitación sigue saliendo dentro de la sección crítica, con el
   * lock pesimista tomado: es la deuda que documenta el `ponytail:` de
   * `member.service.ts`.
   */
  async approve(
    id: string,
    actorUserId: string,
  ): Promise<VolunteerRequestView> {
    const organizationId = this.orgId;
    const updated = await this.tenantContext
      .getManager()
      .transaction(async (trx: EntityManager) => {
        const repo = trx.getRepository(VolunteerRequest);
        const request = await this.findPendingOrFail(repo, id, organizationId);

        if (request.opportunityId) {
          const opportunity = await trx
            .getRepository(VolunteerOpportunity)
            .findOne({
              where: { id: request.opportunityId, organizationId },
              lock: { mode: 'pessimistic_write' },
            });
          if (!opportunity) {
            throw new NotFoundException('La actividad no existe.');
          }
          if (opportunity.status === OpportunityStatus.CANCELLED) {
            throw new ConflictException('La actividad está cancelada.');
          }
          if (opportunity.acceptedCount >= opportunity.capacity) {
            throw new ConflictException(
              'La actividad ya cubrió todos sus cupos.',
            );
          }
          opportunity.acceptedCount += 1;
          await trx.getRepository(VolunteerOpportunity).save(opportunity);
        }

        const invitation = await this.memberService.invite(
          organizationId,
          actorUserId,
          {
            email: request.email,
            role: OrganizationMembershipRole.VOLUNTEER,
          },
        );

        request.status = VolunteerRequestStatus.APPROVED;
        request.invitationId = invitation.id;
        request.decidedByUserId = actorUserId;
        request.decidedAt = new Date();
        return repo.save(request);
      });

    const [view] = await this.toViews([updated]);
    return view;
  }

  async reject(
    id: string,
    actorUserId: string,
    reason: string,
  ): Promise<VolunteerRequestView> {
    const organizationId = this.orgId;
    const repo = this.repo();
    const request = await this.findPendingOrFail(repo, id, organizationId);

    request.status = VolunteerRequestStatus.REJECTED;
    request.rejectReason = reason.trim();
    request.decidedByUserId = actorUserId;
    request.decidedAt = new Date();
    const saved = await repo.save(request);

    // Vía autenticada: el interceptor ya retiene un runner para toda la
    // request, así que `this.organizations` pediría al pool una segunda
    // conexión que esta misma request no va a liberar hasta terminar. Con el
    // pool chico de serverless eso no es lentitud, es deadlock.
    const organization = await this.tenantContext
      .getManager()
      .getRepository(Organization)
      .findOneBy({ id: organizationId });
    await this.trySend(() =>
      this.mail.send(
        volunteerRequestRejectedMail(
          saved.email,
          organization?.name ?? 'la organización',
          saved.rejectReason!,
        ),
      ),
    );

    const [view] = await this.toViews([saved]);
    return view;
  }

  /**
   * Acuse al postulante y aviso a quienes gestionan la organización.
   *
   * Los envíos van aislados: la solicitud ya está persistida, y un SMTP caído
   * no puede convertirse en un 500 que le diga al visitante que no se registró.
   */
  private async notifySubmission(
    organization: Organization,
    request: VolunteerRequest,
    opportunityTitle: string | null,
  ): Promise<void> {
    const target =
      opportunityTitle ??
      (request.volunteerTypeId
        ? ((
            await this.volunteerTypes.findOneBy({
              id: request.volunteerTypeId,
            })
          )?.name ?? null)
        : null);

    await this.trySend(() =>
      this.mail.send(
        volunteerRequestReceivedMail(request.email, organization.name, target),
      ),
    );

    const managers = await this.memberships.find({
      where: {
        organizationId: organization.id,
        role: In([...MEMBER_MANAGER_ROLES]),
        active: true,
      },
    });
    if (managers.length === 0) {
      return;
    }
    const recipients = await this.users.find({
      where: { id: In(managers.map((membership) => membership.userId)) },
    });
    const baseUrl = this.config.get<string>(
      'APP_BASE_URL',
      'http://localhost:4200',
    );
    const url = `${baseUrl}/app/voluntariado/solicitudes`;
    for (const recipient of recipients) {
      await this.trySend(() =>
        this.mail.send(
          volunteerRequestNoticeMail(
            recipient.email,
            organization.name,
            request.name,
            target,
            url,
          ),
        ),
      );
    }
  }

  private async trySend(send: () => Promise<unknown>): Promise<void> {
    try {
      await send();
    } catch (error) {
      this.logger.error(
        `No se pudo enviar un correo de solicitud de voluntario: ${String(error)}`,
      );
    }
  }

  private async findPendingOrFail(
    repo: Repository<VolunteerRequest>,
    id: string,
    organizationId: string,
  ): Promise<VolunteerRequest> {
    const request = await repo.findOneBy({ id, organizationId });
    if (!request) {
      throw new NotFoundException('La solicitud no existe.');
    }
    if (request.status !== VolunteerRequestStatus.PENDING) {
      throw new ConflictException('La solicitud ya fue resuelta.');
    }
    return request;
  }

  /** El panel no debería tener que joinear: los nombres se resuelven acá. */
  private async toViews(
    requests: VolunteerRequest[],
  ): Promise<VolunteerRequestView[]> {
    if (requests.length === 0) {
      return [];
    }
    const organizationId = this.orgId;
    const manager = this.tenantContext.getManager();

    const opportunityIds = requests
      .map((request) => request.opportunityId)
      .filter((id): id is string => id !== null);
    const typeIds = requests
      .map((request) => request.volunteerTypeId)
      .filter((id): id is string => id !== null);

    const [opportunities, types] = await Promise.all([
      opportunityIds.length
        ? manager.getRepository(VolunteerOpportunity).find({
            where: { organizationId, id: In(opportunityIds) },
          })
        : Promise.resolve([]),
      typeIds.length
        ? manager
            .getRepository(VolunteerType)
            .find({ where: { organizationId, id: In(typeIds) } })
        : Promise.resolve([]),
    ]);

    const opportunityById = new Map(opportunities.map((o) => [o.id, o.title]));
    const typeById = new Map(types.map((t) => [t.id, t.name]));

    return requests.map((request) => ({
      id: request.id,
      name: request.name,
      email: request.email,
      phone: request.phone,
      message: request.message,
      status: request.status,
      rejectReason: request.rejectReason,
      opportunityId: request.opportunityId,
      opportunityTitle: request.opportunityId
        ? (opportunityById.get(request.opportunityId) ?? null)
        : null,
      volunteerTypeId: request.volunteerTypeId,
      volunteerTypeName: request.volunteerTypeId
        ? (typeById.get(request.volunteerTypeId) ?? null)
        : null,
      createdAt: request.createdAt,
      decidedAt: request.decidedAt,
    }));
  }

  private get orgId(): string {
    return this.tenantContext.organizationId;
  }

  private repo(): Repository<VolunteerRequest> {
    return this.tenantContext.getManager().getRepository(VolunteerRequest);
  }
}
