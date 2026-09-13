import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Organization,
  OrganizationStatus,
} from '../entities/organization.entity';
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

  findPending(): Promise<Organization[]> {
    return this.repo.find({
      where: { status: OrganizationStatus.PENDING },
      order: { createdAt: 'ASC' },
    });
  }

  async transitionFromPending(
    id: string,
    status: OrganizationStatus,
    rejectReason: string | null,
  ): Promise<boolean> {
    const result = await this.repo.update(
      { id, status: OrganizationStatus.PENDING },
      { status, rejectReason },
    );
    return (result.affected ?? 0) > 0;
  }

  save(organization: Organization): Promise<Organization> {
    return this.repo.save(organization);
  }

  async deleteById(id: string): Promise<void> {
    await this.repo.delete({ id });
  }
}
