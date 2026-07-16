import { Inject, Injectable } from '@nestjs/common';
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
import { TenantProvisioningService } from './tenant/tenant-provisioning.service';

@Injectable()
export class OrganizationService {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: IOrganizationRepository,
    @Inject(ORGANIZATION_MEMBERSHIP_REPOSITORY)
    private readonly membershipRepository: IOrganizationMembershipRepository,
    private readonly tenantProvisioningService: TenantProvisioningService,
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
    const organization = await this.dataSource.transaction(async (manager) => {
      const org = await manager.save(
        manager.create(Organization, {
          ownerId: userId,
          name: dto.name,
          description: dto.description,
          address: dto.address,
          contact: dto.contact,
          // HACK temporal: sin flujo de validación de admin todavía, toda
          // organización nueva nace validada para no bloquear el resto de
          // los módulos (insumos, necesidades, etc). Sacar cuando exista
          // un endpoint real de validación.
          status: OrganizationStatus.VALIDATED,
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

    try {
      await this.tenantProvisioningService.provision(organization.id);
    } catch (error) {
      await this.organizationRepository.deleteById(organization.id);
      throw error;
    }

    return organization;
  }
}
