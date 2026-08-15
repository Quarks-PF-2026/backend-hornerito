import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ILike, Not, Repository } from 'typeorm';
import { TenantContextService } from '../tenant/tenant-context.service';
import { CreateVolunteerTypeDto } from './dto/create-volunteer-type.dto';
import { UpdateVolunteerTypeDto } from './dto/update-volunteer-type.dto';
import { VolunteerType } from './entities/volunteer-type.entity';

@Injectable()
export class VolunteerTypeService {
  constructor(private readonly tenantContext: TenantContextService) {}

  async listMine(): Promise<VolunteerType[]> {
    return this.repo().find({ where: { organizationId: this.orgId } });
  }

  async create(dto: CreateVolunteerTypeDto): Promise<VolunteerType> {
    const repo = this.repo();
    await this.assertNameAvailable(dto.name);
    return repo.save(
      repo.create({ ...dto, organizationId: this.orgId, active: true }),
    );
  }

  async update(
    id: string,
    dto: UpdateVolunteerTypeDto,
  ): Promise<VolunteerType> {
    const type = await this.findOrFail(id);
    await this.assertNameAvailable(dto.name, id);
    type.name = dto.name;
    return this.repo().save(type);
  }

  async toggle(id: string): Promise<VolunteerType> {
    const type = await this.findOrFail(id);
    type.active = !type.active;
    return this.repo().save(type);
  }

  private async findOrFail(id: string): Promise<VolunteerType> {
    const type = await this.repo().findOneBy({
      id,
      organizationId: this.orgId,
    });
    if (!type) {
      throw new NotFoundException('El tipo de voluntario no existe.');
    }
    return type;
  }

  private async assertNameAvailable(
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const existing = await this.repo().findOne({
      where: {
        organizationId: this.orgId,
        name: ILike(name),
        ...(exceptId ? { id: Not(exceptId) } : {}),
      },
    });
    if (existing) {
      throw new ConflictException(
        'Ya existe un tipo de voluntario con ese nombre.',
      );
    }
  }

  private get orgId(): string {
    return this.tenantContext.organizationId;
  }

  private repo(): Repository<VolunteerType> {
    return this.tenantContext.getManager().getRepository(VolunteerType);
  }
}
