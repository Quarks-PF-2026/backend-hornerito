import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from '../entities/organization.entity';
import { IOrganizationRepository } from './organization-repository.interface';

@Injectable()
export class TypeOrmOrganizationRepository implements IOrganizationRepository {
  constructor(
    @InjectRepository(Organization)
    private readonly repo: Repository<Organization>,
  ) {}

  findByOwnerId(ownerId: string): Promise<Organization | null> {
    return this.repo.findOneBy({ ownerId });
  }

  create(organization: Partial<Organization>): Promise<Organization> {
    return this.repo.save(this.repo.create(organization));
  }

  save(organization: Organization): Promise<Organization> {
    return this.repo.save(organization);
  }
}
