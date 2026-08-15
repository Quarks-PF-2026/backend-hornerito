import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager, In, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { TenantContextService } from '../tenant/tenant-context.service';
import { VolunteerType } from '../volunteer-type/entities/volunteer-type.entity';
import { CreateOpportunityDto } from './dto/create-opportunity.dto';
import { UpdateOpportunityDto } from './dto/update-opportunity.dto';
import {
  ApplicationStatus,
  VolunteerApplication,
} from './entities/volunteer-application.entity';
import {
  OpportunityStatus,
  VolunteerOpportunity,
  isOpportunityOpen,
} from './entities/volunteer-opportunity.entity';

export interface OpportunityResponse extends VolunteerOpportunity {
  /** Deriva de status + cupos; ver `isOpportunityOpen`. */
  isOpen: boolean;
  /** Notificación in-app: cómo le fue al voluntario que está mirando. */
  myApplicationStatus: ApplicationStatus | null;
  pendingCount: number;
}

export interface ApplicationResponse {
  id: string;
  opportunityId: string;
  userId: string;
  volunteerName: string;
  volunteerEmail: string;
  status: ApplicationStatus;
  createdAt: Date;
  decidedAt: Date | null;
}

@Injectable()
export class VolunteeringService {
  constructor(private readonly tenantContext: TenantContextService) {}

  /**
   * Un único listado para los dos lados: el gestor mira `pendingCount` y el
   * voluntario mira `myApplicationStatus`.
   */
  async list(userId: string): Promise<OpportunityResponse[]> {
    const opportunities = await this.opportunities().find({
      where: { organizationId: this.orgId },
      order: { startsAt: 'ASC' },
    });
    if (opportunities.length === 0) {
      return [];
    }

    // Sin `relations`: ninguna entidad del proyecto declara relaciones TypeORM.
    const applications = await this.applications().find({
      where: {
        organizationId: this.orgId,
        opportunityId: In(opportunities.map((o) => o.id)),
      },
    });

    const mine = new Map<string, ApplicationStatus>();
    const pending = new Map<string, number>();
    for (const application of applications) {
      if (application.userId === userId) {
        mine.set(application.opportunityId, application.status);
      }
      if (application.status === ApplicationStatus.PENDING) {
        pending.set(
          application.opportunityId,
          (pending.get(application.opportunityId) ?? 0) + 1,
        );
      }
    }

    return opportunities.map((opportunity) => ({
      ...opportunity,
      isOpen: isOpportunityOpen(opportunity),
      myApplicationStatus: mine.get(opportunity.id) ?? null,
      pendingCount: pending.get(opportunity.id) ?? 0,
    }));
  }

  async create(dto: CreateOpportunityDto): Promise<VolunteerOpportunity> {
    const repo = this.opportunities();
    const volunteerTypeId = await this.resolveVolunteerTypeId(dto);
    return repo.save(
      repo.create({
        organizationId: this.orgId,
        title: dto.title,
        description: dto.description,
        startsAt: new Date(dto.startsAt),
        location: dto.location,
        volunteerTypeId,
        capacity: dto.capacity,
        acceptedCount: 0,
        status: OpportunityStatus.OPEN,
      }),
    );
  }

  async update(
    id: string,
    dto: UpdateOpportunityDto,
  ): Promise<VolunteerOpportunity> {
    const opportunity = await this.findOpportunityOrFail(id);
    if (opportunity.status !== OpportunityStatus.OPEN) {
      throw new ConflictException(
        'Solo se puede editar una oportunidad abierta.',
      );
    }
    if (dto.capacity < opportunity.acceptedCount) {
      throw new ConflictException(
        `Ya hay ${opportunity.acceptedCount} voluntarios aceptados: los cupos no pueden ser menos.`,
      );
    }

    opportunity.title = dto.title;
    opportunity.description = dto.description;
    opportunity.startsAt = new Date(dto.startsAt);
    opportunity.location = dto.location;
    opportunity.volunteerTypeId = await this.resolveVolunteerTypeId(dto);
    opportunity.capacity = dto.capacity;
    return this.opportunities().save(opportunity);
  }

  /** Cierre manual: deja de aceptar postulaciones, las aceptadas siguen valiendo. */
  async close(id: string): Promise<VolunteerOpportunity> {
    return this.setStatus(id, OpportunityStatus.CLOSED);
  }

  /** La actividad no se hace. Baja lógica: las postulaciones quedan como registro. */
  async cancel(id: string): Promise<VolunteerOpportunity> {
    return this.setStatus(id, OpportunityStatus.CANCELLED);
  }

  async apply(
    opportunityId: string,
    userId: string,
  ): Promise<VolunteerApplication> {
    const opportunity = await this.findOpportunityOrFail(opportunityId);
    if (!isOpportunityOpen(opportunity)) {
      throw new ConflictException(
        'La oportunidad ya no acepta nuevas postulaciones.',
      );
    }

    const repo = this.applications();
    const existing = await repo.findOne({
      where: { organizationId: this.orgId, opportunityId, userId },
    });
    if (existing) {
      throw new ConflictException('Ya te postulaste a esta oportunidad.');
    }

    return repo.save(
      repo.create({
        organizationId: this.orgId,
        opportunityId,
        userId,
        status: ApplicationStatus.PENDING,
        decidedAt: null,
      }),
    );
  }

  async listApplications(
    opportunityId: string,
  ): Promise<ApplicationResponse[]> {
    await this.findOpportunityOrFail(opportunityId);

    const applications = await this.applications().find({
      where: { organizationId: this.orgId, opportunityId },
      order: { createdAt: 'ASC' },
    });
    if (applications.length === 0) {
      return [];
    }

    const users = await this.tenantContext
      .getManager()
      .getRepository(User)
      .find({ where: { id: In(applications.map((a) => a.userId)) } });
    const byId = new Map(users.map((user) => [user.id, user]));

    return applications.map((application) => ({
      id: application.id,
      opportunityId: application.opportunityId,
      userId: application.userId,
      volunteerName: byId.get(application.userId)?.name ?? 'Voluntario',
      volunteerEmail: byId.get(application.userId)?.email ?? '',
      status: application.status,
      createdAt: application.createdAt,
      decidedAt: application.decidedAt,
    }));
  }

  /**
   * El cupo se consume acá, no al postularse. Lock pesimista sobre la
   * oportunidad para que dos gestores aceptando a la vez no pasen `capacity`.
   * El manager viene del query runner del request, así que la transacción
   * hereda el `SET ROLE` y `app.current_org` — RLS sigue activo.
   */
  async accept(applicationId: string): Promise<VolunteerApplication> {
    return this.tenantContext
      .getManager()
      .transaction(async (trx: EntityManager) => {
        const applications = trx.getRepository(VolunteerApplication);
        const application = await this.findApplicationOrFail(
          applications,
          applicationId,
        );

        const opportunity = await trx
          .getRepository(VolunteerOpportunity)
          .findOne({
            where: {
              id: application.opportunityId,
              organizationId: this.orgId,
            },
            lock: { mode: 'pessimistic_write' },
          });
        if (!opportunity) {
          throw new NotFoundException('La oportunidad no existe.');
        }
        if (opportunity.acceptedCount >= opportunity.capacity) {
          throw new ConflictException(
            'La oportunidad ya cubrió todos sus cupos.',
          );
        }
        if (opportunity.status === OpportunityStatus.CANCELLED) {
          throw new ConflictException('La oportunidad está cancelada.');
        }

        opportunity.acceptedCount += 1;
        await trx.getRepository(VolunteerOpportunity).save(opportunity);

        application.status = ApplicationStatus.ACCEPTED;
        application.decidedAt = new Date();
        return applications.save(application);
      });
  }

  async reject(applicationId: string): Promise<VolunteerApplication> {
    const repo = this.applications();
    const application = await this.findApplicationOrFail(repo, applicationId);
    application.status = ApplicationStatus.REJECTED;
    application.decidedAt = new Date();
    return repo.save(application);
  }

  private async setStatus(
    id: string,
    status: OpportunityStatus,
  ): Promise<VolunteerOpportunity> {
    const opportunity = await this.findOpportunityOrFail(id);
    opportunity.status = status;
    return this.opportunities().save(opportunity);
  }

  /**
   * La FK compuesta ya impide apuntar a un tipo de otra organización, pero
   * romperla devolvería un 500: se valida antes para responder 404.
   */
  private async resolveVolunteerTypeId(
    dto: CreateOpportunityDto,
  ): Promise<string | null> {
    const id = dto.volunteerTypeId ?? null;
    if (!id) {
      return null;
    }
    const type = await this.tenantContext
      .getManager()
      .getRepository(VolunteerType)
      .findOneBy({ id, organizationId: this.orgId });
    if (!type) {
      throw new NotFoundException('El tipo de voluntario no existe.');
    }
    return type.id;
  }

  private async findOpportunityOrFail(
    id: string,
  ): Promise<VolunteerOpportunity> {
    const opportunity = await this.opportunities().findOneBy({
      id,
      organizationId: this.orgId,
    });
    if (!opportunity) {
      throw new NotFoundException('La oportunidad de voluntariado no existe.');
    }
    return opportunity;
  }

  private async findApplicationOrFail(
    repo: Repository<VolunteerApplication>,
    id: string,
  ): Promise<VolunteerApplication> {
    const application = await repo.findOneBy({
      id,
      organizationId: this.orgId,
    });
    if (!application) {
      throw new NotFoundException('La postulación no existe.');
    }
    if (application.status !== ApplicationStatus.PENDING) {
      throw new ConflictException('La postulación ya fue resuelta.');
    }
    return application;
  }

  private get orgId(): string {
    return this.tenantContext.organizationId;
  }

  private opportunities(): Repository<VolunteerOpportunity> {
    return this.tenantContext.getManager().getRepository(VolunteerOpportunity);
  }

  private applications(): Repository<VolunteerApplication> {
    return this.tenantContext.getManager().getRepository(VolunteerApplication);
  }
}
