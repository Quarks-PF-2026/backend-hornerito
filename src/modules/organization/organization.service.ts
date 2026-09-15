import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  Organization,
  OrganizationStatus,
} from './entities/organization.entity';
import {
  OrganizationMembership,
  OrganizationMembershipRole,
} from './entities/organization-membership.entity';
import {
  DEFAULT_VOLUNTEER_TYPES,
  VolunteerType,
} from '../volunteer-type/entities/volunteer-type.entity';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import type { IOrganizationRepository } from './repositories/organization-repository.interface';
import { ORGANIZATION_REPOSITORY } from './repositories/organization-repository.interface';
import type { IOrganizationMembershipRepository } from './repositories/organization-membership-repository.interface';
import { ORGANIZATION_MEMBERSHIP_REPOSITORY } from './repositories/organization-membership-repository.interface';
import type { IUserRepository } from '../auth/repositories/user-repository.interface';
import { USER_REPOSITORY } from '../auth/repositories/user-repository.interface';
import { MailService } from '../mail/mail.service';
import {
  organizationRejectedMail,
  organizationValidatedMail,
} from '../mail/templates';

/** Fila de la cola de organizaciones pendientes (QK-19). */
export interface PendingOrganizationView {
  id: string;
  name: string;
  description: string;
  address: string;
  contact: string;
  createdAt: string;
  owner: { name: string; email: string };
}

@Injectable()
export class OrganizationService {
  private readonly logger = new Logger(OrganizationService.name);

  constructor(
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: IOrganizationRepository,
    @Inject(ORGANIZATION_MEMBERSHIP_REPOSITORY)
    private readonly membershipRepository: IOrganizationMembershipRepository,
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async listMine(userId: string): Promise<Organization[]> {
    const memberships = await this.membershipRepository.findByUserId(userId);
    if (memberships.length === 0) {
      return [];
    }
    return this.organizationRepository.findByIds(
      memberships.map((membership) => membership.organizationId),
    );
  }

  async upsertMine(
    userId: string,
    dto: UpdateOrganizationDto,
  ): Promise<Organization> {
    const existing = await this.findOwnedOrganization(userId);

    if (existing) {
      existing.name = dto.name;
      existing.description = dto.description;
      existing.address = dto.address;
      existing.contact = dto.contact;
      if (dto.seeksVolunteers !== undefined) {
        existing.seeksVolunteers = dto.seeksVolunteers;
      }
      // Un string vacío es "borrar el dato"; `undefined` es "no lo mandaron".
      if (dto.paymentAlias !== undefined) {
        existing.paymentAlias = dto.paymentAlias.trim() || null;
      }
      if (dto.paymentHolder !== undefined) {
        existing.paymentHolder = dto.paymentHolder.trim() || null;
      }
      if (dto.paymentCuit !== undefined) {
        existing.paymentCuit = dto.paymentCuit.trim() || null;
      }
      if (dto.paymentBank !== undefined) {
        existing.paymentBank = dto.paymentBank.trim() || null;
      }
      Object.assign(existing, this.locationOf(dto));
      if (existing.status === OrganizationStatus.REJECTED) {
        existing.status = OrganizationStatus.PENDING;
        existing.rejectReason = null;
      }
      return this.organizationRepository.save(existing);
    }

    // Un miembro que no es dueño no edita el perfil ni se crea una organización
    // propia por accidente al llamar a este endpoint.
    const memberships = await this.membershipRepository.findByUserId(userId);
    if (memberships.length > 0) {
      throw new ForbiddenException(
        'Solo el dueño puede editar los datos de la organización.',
      );
    }

    return this.createMine(userId, dto);
  }

  /**
   * El trío localidad/provincia/país viaja junto: sale de una sola sugerencia
   * del geocoder (QK-112). Escribirlo campo por campo dejaría combinaciones
   * que ninguna sugerencia produjo — localidad nueva con provincia vieja.
   * `locality` es la llave del bloque: si no viene, la ubicación guardada no
   * se toca, así que reenviar el perfil sin estos campos (el interruptor de
   * voluntarios lo hace) no la borra.
   */
  private locationOf(dto: UpdateOrganizationDto): Partial<Organization> {
    if (dto.locality === undefined) {
      return {};
    }
    return {
      locality: dto.locality.trim() || null,
      province: dto.province?.trim() || null,
      country: dto.country?.trim() || null,
    };
  }

  async getOwnedOrganization(userId: string): Promise<Organization | null> {
    return this.findOwnedOrganization(userId);
  }

  private async findOwnedOrganization(
    userId: string,
  ): Promise<Organization | null> {
    const memberships = await this.membershipRepository.findByUserId(userId);
    const owned = memberships.find(
      (membership) => membership.role === OrganizationMembershipRole.OWNER,
    );
    return owned
      ? this.organizationRepository.findById(owned.organizationId)
      : null;
  }

  private async createMine(
    userId: string,
    dto: UpdateOrganizationDto,
  ): Promise<Organization> {
    return this.dataSource.transaction(async (manager) => {
      const org = await manager.save(
        manager.create(Organization, {
          ownerId: userId,
          name: dto.name,
          description: dto.description,
          address: dto.address,
          contact: dto.contact,
          seeksVolunteers: dto.seeksVolunteers ?? false,
          paymentAlias: dto.paymentAlias?.trim() || null,
          paymentHolder: dto.paymentHolder?.trim() || null,
          paymentCuit: dto.paymentCuit?.trim() || null,
          paymentBank: dto.paymentBank?.trim() || null,
          ...this.locationOf(dto),
          // Nace `pending` (default de la entidad): un platform admin la
          // valida o rechaza vía `/admin/organizations` (QK-19).
        }),
      );
      await manager.save(
        manager.create(OrganizationMembership, {
          userId,
          organizationId: org.id,
          role: OrganizationMembershipRole.OWNER,
        }),
      );
      // Catálogo inicial de tipos de voluntario (QK-33), para que el
      // formulario de una actividad nunca arranque con el select vacío.
      await manager.save(
        DEFAULT_VOLUNTEER_TYPES.map((name) =>
          manager.create(VolunteerType, { organizationId: org.id, name }),
        ),
      );
      return org;
    });
  }

  /** Cola de postulaciones a revisar por un platform admin (QK-19). */
  async listPendingOrganizations(): Promise<PendingOrganizationView[]> {
    const organizations = await this.organizationRepository.findPending();
    if (organizations.length === 0) {
      return [];
    }
    const owners = await this.userRepository.findByIds(
      organizations.map((organization) => organization.ownerId),
    );
    const ownerById = new Map(owners.map((owner) => [owner.id, owner]));
    return organizations.map((organization) => ({
      id: organization.id,
      name: organization.name,
      description: organization.description,
      address: organization.address,
      contact: organization.contact,
      createdAt: organization.createdAt.toISOString(),
      owner: {
        name: ownerById.get(organization.ownerId)?.name ?? '',
        email: ownerById.get(organization.ownerId)?.email ?? '',
      },
    }));
  }

  /** Usado por un platform admin (QK-19). */
  async validate(organizationId: string): Promise<Organization> {
    const saved = await this.transitionFromPending(
      organizationId,
      OrganizationStatus.VALIDATED,
      null,
      'Solo se puede validar una organización pendiente.',
    );
    await this.notifyOwner(saved, (ownerEmail) =>
      organizationValidatedMail(
        ownerEmail,
        saved.name,
        this.appUrl('/app/organizacion'),
      ),
    );
    return saved;
  }

  /** Usado por un platform admin (QK-19). El motivo se guarda trimmeado. */
  async reject(organizationId: string, reason: string): Promise<Organization> {
    const trimmedReason = reason.trim();
    const saved = await this.transitionFromPending(
      organizationId,
      OrganizationStatus.REJECTED,
      trimmedReason,
      'Solo se puede rechazar una organización pendiente.',
    );
    await this.notifyOwner(saved, (ownerEmail) =>
      organizationRejectedMail(
        ownerEmail,
        saved.name,
        trimmedReason,
        this.appUrl('/app/organizacion'),
      ),
    );
    return saved;
  }

  private async requireOrganization(id: string): Promise<Organization> {
    const organization = await this.organizationRepository.findById(id);
    if (!organization) {
      throw new NotFoundException('La organización no existe.');
    }
    return organization;
  }

  /**
   * UPDATE condicional (`pending` -> `status`) en vez de read-then-write:
   * dos platform admins decidiendo la misma organización a la vez podían
   * pisarse sin que ninguno viera un 409, y el owner terminaba recibiendo dos
   * correos contradictorios. Sin locks ni transacción explícita (KISS): el
   * propio UPDATE condicional ya es la sección atómica.
   */
  private async transitionFromPending(
    id: string,
    status: OrganizationStatus,
    rejectReason: string | null,
    conflictMessage: string,
  ): Promise<Organization> {
    const won = await this.organizationRepository.transitionFromPending(
      id,
      status,
      rejectReason,
    );
    if (!won) {
      // El UPDATE no afectó filas: puede ser que no exista (404) o que ya
      // haya salido de `pending` (409). Una sola lectura extra, solo en el
      // camino de error, alcanza para distinguirlos.
      await this.requireOrganization(id);
      throw new ConflictException(conflictMessage);
    }
    return this.requireOrganization(id);
  }

  private appUrl(path: string): string {
    const baseUrl = this.config.get<string>(
      'APP_BASE_URL',
      'http://localhost:4200',
    );
    return `${baseUrl}${path}`;
  }

  /**
   * El correo es un aviso posterior a una transición que ya quedó persistida:
   * si el envío falla no tiene sentido devolver un error al platform admin
   * (la validación/el rechazo ya son un hecho), así que se loguea y se sigue
   * — mismo criterio que `VolunteerRequestService.trySend`.
   */
  private async notifyOwner(
    organization: Organization,
    buildMessage: (
      ownerEmail: string,
    ) => ReturnType<
      typeof organizationValidatedMail | typeof organizationRejectedMail
    >,
  ): Promise<void> {
    const owner = await this.userRepository.findById(organization.ownerId);
    if (!owner) {
      this.logger.error(
        `No se encontró el owner ${organization.ownerId} de la organización ${organization.id} para notificarle la validación/rechazo.`,
      );
      return;
    }
    try {
      await this.mail.send(buildMessage(owner.email));
    } catch (error) {
      this.logger.error(
        `No se pudo enviar el correo de validación/rechazo de la organización ${organization.id} a ${owner.email}: ${String(error)}`,
      );
    }
  }
}
