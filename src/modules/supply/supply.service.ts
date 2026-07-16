import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ILike, Repository } from 'typeorm';
import { TenantContextService } from '../tenant/tenant-context.service';
import { CreateSupplyDto } from './dto/create-supply.dto';
import { UpdateSupplyDto } from './dto/update-supply.dto';
import { Supply } from './entities/supply.entity';

@Injectable()
export class SupplyService {
  constructor(private readonly tenantContext: TenantContextService) {}

  async listMine(): Promise<Supply[]> {
    const repo = await this.repo();
    return repo.find();
  }

  async create(dto: CreateSupplyDto): Promise<Supply> {
    const repo = await this.repo();
    await this.assertNameAvailable(repo, dto.name);
    return repo.save(repo.create({ ...dto, active: true }));
  }

  async update(id: string, dto: UpdateSupplyDto): Promise<Supply> {
    const repo = await this.repo();
    const supply = await repo.findOneBy({ id });
    if (!supply) {
      throw new NotFoundException('El insumo no existe.');
    }
    await this.assertNameAvailable(repo, dto.name, id);
    supply.name = dto.name;
    supply.category = dto.category;
    supply.unit = dto.unit;
    return repo.save(supply);
  }

  async toggle(id: string): Promise<Supply> {
    const repo = await this.repo();
    const supply = await repo.findOneBy({ id });
    if (!supply) {
      throw new NotFoundException('El insumo no existe.');
    }
    supply.active = !supply.active;
    return repo.save(supply);
  }

  private async assertNameAvailable(
    repo: Repository<Supply>,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const existing = await repo.findOne({ where: { name: ILike(name) } });
    if (existing && existing.id !== exceptId) {
      throw new ConflictException('Ya existe un insumo con ese nombre.');
    }
  }

  private async repo(): Promise<Repository<Supply>> {
    const manager = await this.tenantContext.getManager();
    return manager.getRepository(Supply);
  }
}
