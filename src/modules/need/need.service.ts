import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { PublicMirrorService } from '../public/public-mirror.service';
import { Supply } from '../supply/entities/supply.entity';
import { TenantContextService } from '../tenant/tenant-context.service';
import { CreateNeedDto } from './dto/create-need.dto';
import { UpdateNeedDto } from './dto/update-need.dto';
import { UpdateProgressDto } from './dto/update-progress.dto';
import { Need } from './entities/need.entity';

@Injectable()
export class NeedService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly publicMirror: PublicMirrorService,
  ) {}

  async listMine(): Promise<Need[]> {
    const repo = await this.repo();
    return repo.find();
  }

  async create(dto: CreateNeedDto): Promise<Need> {
    const repo = await this.repo();
    const supply = await this.assertSupplyExists(dto.supplyId);
    const need = await repo.save(
      repo.create({ ...dto, coveredQuantity: 0, closedManually: false }),
    );
    return this.mirror(need, supply);
  }

  async update(id: string, dto: UpdateNeedDto): Promise<Need> {
    const need = await this.findOpenOrFail(id);
    const supply = await this.assertSupplyExists(dto.supplyId);
    need.supplyId = dto.supplyId;
    need.requiredQuantity = dto.requiredQuantity;
    need.deadline = dto.deadline;
    const repo = await this.repo();
    return this.mirror(await repo.save(need), supply);
  }

  async updateProgress(id: string, dto: UpdateProgressDto): Promise<Need> {
    const need = await this.findOpenOrFail(id);
    need.coveredQuantity = dto.coveredQuantity;
    const repo = await this.repo();
    return this.mirror(await repo.save(need));
  }

  async close(id: string): Promise<Need> {
    const need = await this.findOpenOrFail(id);
    need.closedManually = true;
    const repo = await this.repo();
    return this.mirror(await repo.save(need));
  }

  /** Refleja la necesidad en el directorio público. Best-effort, ver PublicMirrorService. */
  private async mirror(need: Need, supply?: Supply): Promise<Need> {
    const resolved = supply ?? (await this.findSupply(need.supplyId));
    if (resolved) {
      await this.publicMirror.upsertNeed(
        this.tenantContext.organizationId,
        need,
        resolved,
      );
    }
    return need;
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

  private async assertSupplyExists(supplyId: string): Promise<Supply> {
    const supply = await this.findSupply(supplyId);
    if (!supply) {
      throw new NotFoundException('El insumo indicado no existe.');
    }
    return supply;
  }

  private async findSupply(supplyId: string): Promise<Supply | null> {
    const manager = await this.tenantContext.getManager();
    return manager.getRepository(Supply).findOneBy({ id: supplyId });
  }

  private async repo(): Promise<Repository<Need>> {
    const manager = await this.tenantContext.getManager();
    return manager.getRepository(Need);
  }
}
