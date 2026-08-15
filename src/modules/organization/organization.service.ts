import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import type { IOrganizationRepository } from './repositories/organization-repository.interface';
import { ORGANIZATION_REPOSITORY } from './repositories/organization-repository.interface';
import type { IOrganizationMembershipRepository } from './repositories/organization-membership-repository.interface';
import { ORGANIZATION_MEMBERSHIP_REPOSITORY } from './repositories/organization-membership-repository.interface';

@Injectable()
export class OrganizationService {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: IOrganizationRepository,
    @Inject(ORGANIZATION_MEMBERSHIP_REPOSITORY)
    private readonly membershipRepository: IOrganizationMembershipRepository,
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
          // Toda organización nace pendiente de validación (default de la
          // entidad); un platform admin la valida o rechaza vía
          // `/admin/organizations` (ver AdminOrganizationService).
        }),
      );
      await manager.save(
        manager.create(OrganizationMembership, {
          userId,
          organizationId: org.id,
          role: OrganizationMembershipRole.OWNER,
        }),
      );
      return org;
    });
  }

  /** Usado por un platform admin (QK-13 CP-13-04). */
  async validate(organizationId: string): Promise<Organization> {
    const organization = await this.requireOrganization(organizationId);
    organization.status = OrganizationStatus.VALIDATED;
    organization.rejectReason = null;
    return this.organizationRepository.save(organization);
  }

  /** Usado por un platform admin (QK-13 CP-13-05). */
  async reject(organizationId: string, reason: string): Promise<Organization> {
    const organization = await this.requireOrganization(organizationId);
    organization.status = OrganizationStatus.REJECTED;
    organization.rejectReason = reason;
    return this.organizationRepository.save(organization);
  }

  private async requireOrganization(id: string): Promise<Organization> {
    const organization = await this.organizationRepository.findById(id);
    if (!organization) {
      throw new NotFoundException('La organización no existe.');
    }
    return organization;
  }
}
