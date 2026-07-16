import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Supply } from '../supply/entities/supply.entity';
import { TenantContextService } from '../tenant/tenant-context.service';
import { CreateNeedDto } from './dto/create-need.dto';
import { UpdateNeedDto } from './dto/update-need.dto';
import { UpdateProgressDto } from './dto/update-progress.dto';
import { Need } from './entities/need.entity';

@Injectable()
export class NeedService {
  constructor(private readonly tenantContext: TenantContextService) {}

  async listMine(): Promise<Need[]> {
    const repo = await this.repo();
    return repo.find();
  }

  async create(dto: CreateNeedDto): Promise<Need> {
    const repo = await this.repo();
    await this.assertSupplyExists(dto.supplyId);
    return repo.save(
      repo.create({ ...dto, coveredQuantity: 0, closedManually: false }),
    );
  }

  async update(id: string, dto: UpdateNeedDto): Promise<Need> {
    const need = await this.findOpenOrFail(id);
    await this.assertSupplyExists(dto.supplyId);
    need.supplyId = dto.supplyId;
    need.requiredQuantity = dto.requiredQuantity;
    need.deadline = dto.deadline;
    const repo = await this.repo();
    return repo.save(need);
  }

  async updateProgress(id: string, dto: UpdateProgressDto): Promise<Need> {
    const need = await this.findOpenOrFail(id);
    need.coveredQuantity = dto.coveredQuantity;
    const repo = await this.repo();
    return repo.save(need);
  }

  async close(id: string): Promise<Need> {
    const need = await this.findOpenOrFail(id);
    need.closedManually = true;
    const repo = await this.repo();
    return repo.save(need);
  }

  private async findOpenOrFail(id: string): Promise<Need> {
    const repo = await this.repo();
    const need = await repo.findOneBy({ id });
    if (!need) {
      throw new NotFoundException('La necesidad no existe.');
    }
    if (this.isClosed(need)) {
      throw new ConflictException('La necesidad ya está cerrada.');
    }
    return need;
  }

  private isClosed(need: Need): boolean {
    return need.closedManually || need.coveredQuantity >= need.requiredQuantity;
  }

  private async assertSupplyExists(supplyId: string): Promise<void> {
    const manager = await this.tenantContext.getManager();
    const supply = await manager.getRepository(Supply).findOneBy({ id: supplyId });
    if (!supply) {
      throw new NotFoundException('El insumo indicado no existe.');
    }
  }

  private async repo(): Promise<Repository<Need>> {
    const manager = await this.tenantContext.getManager();
    return manager.getRepository(Need);
  }
}
