import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ILike, Not, Repository } from 'typeorm';
import { TenantContextService } from '../tenant/tenant-context.service';
import { CreateSupplyDto } from './dto/create-supply.dto';
import { UpdateSupplyDto } from './dto/update-supply.dto';
import { Supply } from './entities/supply.entity';

@Injectable()
export class SupplyService {
  constructor(private readonly tenantContext: TenantContextService) {}

  async listMine(): Promise<Supply[]> {
    return this.repo().find({ where: { organizationId: this.orgId } });
  }

  async create(dto: CreateSupplyDto): Promise<Supply> {
    const repo = this.repo();
    await this.assertNameAvailable(dto.name);
    return repo.save(
      repo.create({ ...dto, organizationId: this.orgId, active: true }),
    );
  }

  async update(id: string, dto: UpdateSupplyDto): Promise<Supply> {
    const supply = await this.findOrFail(id);
    await this.assertNameAvailable(dto.name, id);
    supply.name = dto.name;
    supply.category = dto.category;
    supply.unit = dto.unit;
    return this.repo().save(supply);
  }

  async toggle(id: string): Promise<Supply> {
    const supply = await this.findOrFail(id);
    supply.active = !supply.active;
    return this.repo().save(supply);
  }

  private async findOrFail(id: string): Promise<Supply> {
    const supply = await this.repo().findOneBy({
      id,
      organizationId: this.orgId,
    });
    if (!supply) {
      throw new NotFoundException('El insumo no existe.');
    }
    return supply;
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
      throw new ConflictException('Ya existe un insumo con ese nombre.');
    }
  }

  private get orgId(): string {
    return this.tenantContext.organizationId;
  }

  private repo(): Repository<Supply> {
    return this.tenantContext.getManager().getRepository(Supply);
  }
}
