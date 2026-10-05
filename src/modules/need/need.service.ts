import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { toIsoDate, todayAr } from '../../common/today-ar';
import { Supply } from '../supply/entities/supply.entity';
import { TenantContextService } from '../tenant/tenant-context.service';
import { CreateNeedDto } from './dto/create-need.dto';
import { UpdateNeedDto } from './dto/update-need.dto';
import { UpdateProgressDto } from './dto/update-progress.dto';
import { Need, isNeedClosed, isNeedExpired } from './entities/need.entity';

@Injectable()
export class NeedService {
  constructor(private readonly tenantContext: TenantContextService) {}

  async listMine(): Promise<Need[]> {
    return this.repo().find({ where: { organizationId: this.orgId } });
  }

  async create(dto: CreateNeedDto): Promise<Need> {
    const repo = this.repo();
    this.assertDeadlineNotPast(dto.deadline);
    await this.assertSupplyExists(dto.supplyId);
    return repo.save(
      repo.create({
        ...dto,
        organizationId: this.orgId,
        coveredQuantity: 0,
        closedManually: false,
      }),
    );
  }

  async update(id: string, dto: UpdateNeedDto): Promise<Need> {
    const need = await this.findOpenOrFail(id, true);
    // Vencida: editarla es reabrirla, así que la fecha nueva no puede quedar en el pasado.
    // Abierta: solo se valida si cambia, para no exigir mover una fecha que ya era válida.
    if (
      isNeedExpired(need) ||
      dto.deadline.slice(0, 10) !== toIsoDate(need.deadline)
    ) {
      this.assertDeadlineNotPast(dto.deadline);
    }
    await this.assertSupplyExists(dto.supplyId);
    need.supplyId = dto.supplyId;
    need.requiredQuantity = dto.requiredQuantity;
    need.deadline = dto.deadline;
    return this.repo().save(need);
  }

  async updateProgress(id: string, dto: UpdateProgressDto): Promise<Need> {
    const need = await this.findOpenOrFail(id);
    need.coveredQuantity = dto.coveredQuantity;
    return this.repo().save(need);
  }

  async close(id: string): Promise<Need> {
    const need = await this.findOpenOrFail(id);
    need.closedManually = true;
    return this.repo().save(need);
  }

  /** `allowExpired`: la edición puede reabrir una vencida moviendo la fecha. */
  private async findOpenOrFail(
    id: string,
    allowExpired = false,
  ): Promise<Need> {
    const need = await this.repo().findOneBy({
      id,
      organizationId: this.orgId,
    });
    if (!need) {
      throw new NotFoundException('La necesidad no existe.');
    }
    // Con `allowExpired` se evalúa como si venciera hoy: solo cuentan cierre manual y cobertura.
    const closed = isNeedClosed(
      allowExpired ? { ...need, deadline: todayAr() } : need,
    );
    if (closed) {
      throw new ConflictException('La necesidad ya está cerrada.');
    }
    return need;
  }

  private assertDeadlineNotPast(deadline: string): void {
    if (deadline.slice(0, 10) < todayAr()) {
      throw new BadRequestException(
        'La fecha límite no puede ser anterior a hoy.',
      );
    }
  }

  private async assertSupplyExists(supplyId: string): Promise<Supply> {
    const supply = await this.tenantContext
      .getManager()
      .getRepository(Supply)
      .findOneBy({ id: supplyId, organizationId: this.orgId });
    if (!supply) {
      throw new NotFoundException('El insumo indicado no existe.');
    }
    return supply;
  }

  private get orgId(): string {
    return this.tenantContext.organizationId;
  }

  private repo(): Repository<Need> {
    return this.tenantContext.getManager().getRepository(Need);
  }
}
