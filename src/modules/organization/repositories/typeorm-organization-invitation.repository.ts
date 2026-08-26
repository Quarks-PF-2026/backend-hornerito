import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { OrganizationInvitation } from '../entities/organization-invitation.entity';
import { IOrganizationInvitationRepository } from './organization-invitation-repository.interface';

@Injectable()
export class TypeOrmOrganizationInvitationRepository implements IOrganizationInvitationRepository {
  constructor(
    @InjectRepository(OrganizationInvitation)
    private readonly repo: Repository<OrganizationInvitation>,
  ) {}

  findPendingByOrganization(
    organizationId: string,
  ): Promise<OrganizationInvitation[]> {
    return this.repo.find({
      where: { organizationId, acceptedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }

  findPendingByToken(token: string): Promise<OrganizationInvitation | null> {
    return this.repo.findOneBy({ token, acceptedAt: IsNull() });
  }

  findPendingByEmail(
    organizationId: string,
    email: string,
  ): Promise<OrganizationInvitation | null> {
    return this.repo.findOneBy({
      organizationId,
      email,
      acceptedAt: IsNull(),
    });
  }

  findById(id: string): Promise<OrganizationInvitation | null> {
    return this.repo.findOneBy({ id });
  }

  create(
    invitation: Partial<OrganizationInvitation>,
  ): Promise<OrganizationInvitation> {
    return this.repo.save(this.repo.create(invitation));
  }

  save(invitation: OrganizationInvitation): Promise<OrganizationInvitation> {
    return this.repo.save(invitation);
  }

  async deleteById(id: string): Promise<void> {
    await this.repo.delete({ id });
  }
}
