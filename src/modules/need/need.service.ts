import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { TODAY_AR_TZ, toIsoDate, todayAr } from '../../common/today-ar';
import { EventService } from '../event/event.service';
import { Supply } from '../supply/entities/supply.entity';
import { TenantContextService } from '../tenant/tenant-context.service';
import { CreateNeedDto } from './dto/create-need.dto';
import { UpdateNeedDto } from './dto/update-need.dto';
import { UpdateProgressDto } from './dto/update-progress.dto';
import { Need, isNeedClosed, isNeedExpired } from './entities/need.entity';

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
  deadline: Date | string;
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
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly events: EventService,
  ) {}

  async listMine(): Promise<Need[]> {
    return this.repo().find({ where: { organizationId: this.orgId } });
  }

  async create(dto: CreateNeedDto): Promise<Need> {
    const repo = this.repo();
    this.assertDeadlineNotPast(dto.deadline);
    await this.assertSupplyExists(dto.supplyId);
    const eventId = await this.events.resolveLinkableId(dto.eventId);
    return repo.save(
      repo.create({
        ...dto,
        eventId,
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
    need.eventId = await this.events.resolveLinkableId(
      dto.eventId,
      need.eventId,
    );
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
      .addSelect('n.deadline', 'deadline')
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
