import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { TODAY_AR_TZ } from '../../common/today-ar';
import { Supply } from '../supply/entities/supply.entity';
import { TenantContextService } from '../tenant/tenant-context.service';
import { CreateNeedDto } from './dto/create-need.dto';
import { UpdateNeedDto } from './dto/update-need.dto';
import { UpdateProgressDto } from './dto/update-progress.dto';
import { Need, isNeedClosed } from './entities/need.entity';

/** Ventana de historial que cuenta para sugerir, y tope de sugerencias. */
export const SUGGESTION_WINDOW_DAYS = 90;
export const MAX_SUGGESTIONS = 3;

export interface NeedSuggestion {
  supplyId: string;
  supplyName: string;
  category: string;
  timesRequested: number;
  lastRequestedAt: string;
}

export interface SuggestionInput {
  supplyId: string;
  supplyName: string;
  category: string;
  createdAt: Date;
  closedManually: boolean;
  coveredQuantity: number;
  requiredQuantity: number;
}

const dayInOrgTz = new Intl.DateTimeFormat('en-CA', { timeZone: TODAY_AR_TZ });

/**
 * Insumos pedidos en los últimos 90 días y hoy sin necesidad abierta, los más
 * pedidos primero. Recibe TODAS las necesidades de insumos activos (no solo
 * las de la ventana) porque "abierta hoy" no depende de la ventana. Se decide
 * en TS con `isNeedClosed` para no duplicar esa regla en SQL.
 */
export function buildSuggestions(
  rows: SuggestionInput[],
  now: Date,
): NeedSuggestion[] {
  const since = now.getTime() - SUGGESTION_WINDOW_DAYS * 86_400_000;
  const withOpen = new Set(
    rows.filter((r) => !isNeedClosed(r)).map((r) => r.supplyId),
  );
  const bySupply = new Map<string, NeedSuggestion & { last: number }>();
  for (const r of rows) {
    const at = r.createdAt.getTime();
    if (at < since || withOpen.has(r.supplyId)) continue;
    const acc = bySupply.get(r.supplyId) ?? {
      supplyId: r.supplyId,
      supplyName: r.supplyName,
      category: r.category,
      timesRequested: 0,
      lastRequestedAt: '',
      last: 0,
    };
    acc.timesRequested++;
    acc.last = Math.max(acc.last, at);
    bySupply.set(r.supplyId, acc);
  }
  return [...bySupply.values()]
    .sort((a, b) => b.timesRequested - a.timesRequested || b.last - a.last)
    .slice(0, MAX_SUGGESTIONS)
    .map(({ last, ...s }) => ({
      ...s,
      lastRequestedAt: dayInOrgTz.format(new Date(last)),
    }));
}

@Injectable()
export class NeedService {
  constructor(private readonly tenantContext: TenantContextService) {}

  async listMine(): Promise<Need[]> {
    return this.repo().find({ where: { organizationId: this.orgId } });
  }

  async create(dto: CreateNeedDto): Promise<Need> {
    const repo = this.repo();
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
    const need = await this.findOpenOrFail(id);
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

  async suggestions(): Promise<NeedSuggestion[]> {
    // Join explícito: las entidades no declaran relaciones TypeORM.
    const rows = await this.tenantContext
      .getManager()
      .createQueryBuilder()
      .select('n."supplyId"', 'supplyId')
      .addSelect('s.name', 'supplyName')
      .addSelect('s.category', 'category')
      .addSelect('n."createdAt"', 'createdAt')
      .addSelect('n."closedManually"', 'closedManually')
      .addSelect('n."coveredQuantity"', 'coveredQuantity')
      .addSelect('n."requiredQuantity"', 'requiredQuantity')
      .from(Need, 'n')
      .innerJoin(
        Supply,
        's',
        's.id = n."supplyId" AND s."organizationId" = n."organizationId"',
      )
      .where('n."organizationId" = :orgId', { orgId: this.orgId })
      .andWhere('s."organizationId" = :orgId', { orgId: this.orgId })
      .andWhere('s.active = true')
      .getRawMany<SuggestionInput>();
    return buildSuggestions(rows, new Date());
  }

  private async findOpenOrFail(id: string): Promise<Need> {
    const need = await this.repo().findOneBy({
      id,
      organizationId: this.orgId,
    });
    if (!need) {
      throw new NotFoundException('La necesidad no existe.');
    }
    if (isNeedClosed(need)) {
      throw new ConflictException('La necesidad ya está cerrada.');
    }
    return need;
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
