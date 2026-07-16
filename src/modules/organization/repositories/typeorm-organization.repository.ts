import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Organization } from '../entities/organization.entity';
import { IOrganizationRepository } from './organization-repository.interface';

@Injectable()
export class TypeOrmOrganizationRepository implements IOrganizationRepository {
  constructor(
    @InjectRepository(Organization)
    private readonly repo: Repository<Organization>,
  ) {}

  findById(id: string): Promise<Organization | null> {
    return this.repo.findOneBy({ id });
  }

  findByIds(ids: string[]): Promise<Organization[]> {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }
    return this.repo.findBy({ id: In(ids) });
  }

  save(organization: Organization): Promise<Organization> {
    return this.repo.save(organization);
  }

  async deleteById(id: string): Promise<void> {
    await this.repo.delete({ id });
  }
}
