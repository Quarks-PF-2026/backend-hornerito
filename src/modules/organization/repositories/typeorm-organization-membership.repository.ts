import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrganizationMembership } from '../entities/organization-membership.entity';
import { IOrganizationMembershipRepository } from './organization-membership-repository.interface';

@Injectable()
export class TypeOrmOrganizationMembershipRepository implements IOrganizationMembershipRepository {
  constructor(
    @InjectRepository(OrganizationMembership)
    private readonly repo: Repository<OrganizationMembership>,
  ) {}

  findByUserId(userId: string): Promise<OrganizationMembership[]> {
    return this.repo.find({ where: { userId } });
  }

  findByUserAndOrganization(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationMembership | null> {
    return this.repo.findOneBy({ userId, organizationId });
  }
}
