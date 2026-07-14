import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  Organization,
  OrganizationStatus,
} from './entities/organization.entity';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import type { IOrganizationRepository } from './repositories/organization-repository.interface';
import { ORGANIZATION_REPOSITORY } from './repositories/organization-repository.interface';

@Injectable()
export class OrganizationService {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: IOrganizationRepository,
  ) {}

  async getMine(ownerId: string): Promise<Organization> {
    const organization =
      await this.organizationRepository.findByOwnerId(ownerId);
    if (!organization) {
      throw new NotFoundException(
        'Todavía no cargaste los datos de tu organización.',
      );
    }
    return organization;
  }

  async upsertMine(
    ownerId: string,
    dto: UpdateOrganizationDto,
  ): Promise<Organization> {
    const existing =
      await this.organizationRepository.findByOwnerId(ownerId);

    if (!existing) {
      return this.organizationRepository.create({
        ownerId,
        name: dto.name,
        description: dto.description,
        address: dto.address,
        contact: dto.contact,
        status: OrganizationStatus.PENDING,
      });
    }

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
}
