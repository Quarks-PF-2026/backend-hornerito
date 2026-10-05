import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Between, Repository } from 'typeorm';
import { todayAr } from '../../common/today-ar';
import { TenantContextService } from '../tenant/tenant-context.service';
import { CreateEventDto } from './dto/create-event.dto';
import { DATE_ONLY_REGEX } from './dto/date-only.regex';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { EventAttendance } from './entities/event-attendance.entity';
import { EventKind, OrgEvent } from './entities/event.entity';

export interface Occurrence {
  date: string;
  count: number | null;
}

/** Lo mínimo que necesitan las funciones puras de ocurrencias. */
export interface EventOccurrenceInput {
  kind: EventKind;
  startDate: string;
  endedOn: string | null;
  /** 0 = domingo … 6 = sábado. Null en extraordinarios. */
  weekdays: number[] | null;
}

const MAX_RANGE_DAYS = 366;
const DEFAULT_RANGE_DAYS = 29;

/**
 * ¿`date` es una ocurrencia real del evento? Periódico: los días desde
 * `startDate` hasta hoy o hasta la baja (`endedOn`), lo que sea antes, que
 * caigan en uno de sus `weekdays`.
 * Extraordinario: únicamente `startDate`, pasado o futuro (existe para
 * mostrarse aunque todavía no se le pueda cargar asistencia).
 */
export function isOccurrence(
  event: EventOccurrenceInput,
  date: string,
  today: string,
): boolean {
  if (event.kind === EventKind.ONE_OFF) {
    return date === event.startDate;
  }
  const upperBound = minDate(event.endedOn ?? today, today);
  return (
    date >= event.startDate && date <= upperBound && onWeekday(event, date)
  );
}

/** Ocurrencias del evento dentro de `[from, to]` (inclusive), en orden ascendente. */
export function occurrenceDates(
  event: EventOccurrenceInput,
  from: string,
  to: string,
  today: string,
): string[] {
  if (event.kind === EventKind.ONE_OFF) {
    return event.startDate >= from && event.startDate <= to
      ? [event.startDate]
      : [];
  }
  const upperBound = minDate(event.endedOn ?? today, today);
  const start = maxDate(event.startDate, from);
  const end = minDate(upperBound, to);
  const dates: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (onWeekday(event, d)) dates.push(d);
  }
  return dates;
}

function onWeekday(event: EventOccurrenceInput, date: string): boolean {
  return event.weekdays?.includes(weekdayOf(date)) ?? false;
}

/** Día de la semana de una fecha 'YYYY-MM-DD' (0 = domingo … 6 = sábado), en UTC como `addDays`. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function sortedWeekdays(weekdays: number[]): number[] {
  return [...weekdays].sort((a, b) => a - b);
}

function sameWeekdays(a: number[] | null, b: number[] | null): boolean {
  return (a ?? []).join(',') === (b ?? []).join(',');
}

function minDate(a: string, b: string): string {
  return a < b ? a : b;
}

function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}

/** Suma (o resta, con `days` negativo) días de calendario a una fecha 'YYYY-MM-DD'. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * `:date` de la ruta de asistencia no pasa por `class-validator` (es un
 * `@Param`, no un DTO), así que el service valida a mano. El formato solo no
 * alcanza: `Date.UTC` normaliza un mes o día imposible en vez de rechazarlo
 * (2026-02-30 → 2026-03-02), y eso llegaría crudo a Postgres como `date`
 * inválida (22008) y saldría 500 en vez de 400. `addDays(date, 0)` reusa esa
 * misma normalización para detectar el desvío: si la fecha era real, vuelve
 * idéntica.
 */
function isValidCalendarDate(date: string): boolean {
  return DATE_ONLY_REGEX.test(date) && addDays(date, 0) === date;
}

@Injectable()
export class EventService {
  constructor(private readonly tenantContext: TenantContextService) {}

  async listMine(): Promise<OrgEvent[]> {
    return this.repo().find({
      where: { organizationId: this.orgId },
      order: { active: 'DESC', name: 'ASC' },
    });
  }

  async create(dto: CreateEventDto): Promise<OrgEvent> {
    const repo = this.repo();
    return repo.save(
      repo.create({
        ...dto,
        weekdays:
          dto.kind === EventKind.ONE_OFF ? null : sortedWeekdays(dto.weekdays),
        organizationId: this.orgId,
        active: true,
        endedOn: null,
      }),
    );
  }

  async update(id: string, dto: UpdateEventDto): Promise<OrgEvent> {
    const event = await this.findOrFail(id);
    const kind = dto.kind ?? event.kind;
    // Extraordinario nunca lleva días; si el body no trae weekdays, se
    // conservan los actuales (null si venía de extraordinario).
    const weekdays =
      kind === EventKind.ONE_OFF
        ? null
        : dto.weekdays !== undefined
          ? sortedWeekdays(dto.weekdays)
          : event.weekdays;

    // Lo que define qué fechas son ocurrencia (DOMAIN.md §16). Nombre y hora
    // no lo hacen, por eso quedan editables aunque haya asistencia.
    const changesSchedule =
      kind !== event.kind ||
      (dto.startDate !== undefined && dto.startDate !== event.startDate) ||
      !sameWeekdays(weekdays, event.weekdays);

    if (changesSchedule && (await this.hasAttendance(id))) {
      throw new ConflictException(
        'El evento ya tiene asistencia registrada: solo se puede editar el nombre y la hora de comienzo, no el tipo, la fecha de inicio ni los días de la semana.',
      );
    }

    if (kind === EventKind.PERIODIC && !weekdays?.length) {
      throw new BadRequestException(
        'Elegí al menos un día de la semana para un evento periódico.',
      );
    }

    if (dto.name !== undefined) event.name = dto.name;
    if (dto.startTime !== undefined) event.startTime = dto.startTime;
    if (dto.startDate !== undefined) event.startDate = dto.startDate;
    event.kind = kind;
    event.weekdays = weekdays;
    return this.repo().save(event);
  }

  async deactivate(id: string): Promise<OrgEvent> {
    const event = await this.findOrFail(id);
    if (!event.active) {
      return event; // Idempotente: no reescribe endedOn de una baja anterior.
    }
    event.active = false;
    event.endedOn = todayAr();
    return this.repo().save(event);
  }

  async occurrences(
    id: string,
    from?: string,
    to?: string,
  ): Promise<Occurrence[]> {
    const event = await this.findOrFail(id);
    const today = todayAr();
    const rangeTo = to ?? today;
    const rangeFrom = from ?? addDays(today, -DEFAULT_RANGE_DAYS);
    this.assertValidRange(rangeFrom, rangeTo);

    const dates = occurrenceDates(event, rangeFrom, rangeTo, today);
    if (dates.length === 0) {
      return [];
    }

    const attendances = await this.attendanceRepo().find({
      where: {
        organizationId: this.orgId,
        eventId: id,
        date: Between(dates[0], dates[dates.length - 1]),
      },
    });
    const counts = new Map(attendances.map((a) => [a.date, a.count]));
    return dates.map((date) => ({ date, count: counts.get(date) ?? null }));
  }

  async setAttendance(
    id: string,
    date: string,
    dto: UpdateAttendanceDto,
  ): Promise<{ eventId: string; date: string; count: number }> {
    if (!isValidCalendarDate(date)) {
      throw new BadRequestException(
        'La fecha debe ser una fecha real con formato AAAA-MM-DD.',
      );
    }
    const today = todayAr();
    if (date > today) {
      throw new BadRequestException(
        'No se puede cargar asistencia de una fecha futura.',
      );
    }

    const event = await this.findOrFail(id);
    if (!isOccurrence(event, date, today)) {
      throw new BadRequestException(
        'Esa fecha no corresponde a una ocurrencia del evento.',
      );
    }

    // Upsert: cargar dos veces el mismo día corrige el conteo, no lo duplica
    // (target = UQ_event_attendances_event_date, ver la migración).
    await this.attendanceRepo().upsert(
      { organizationId: this.orgId, eventId: id, date, count: dto.count },
      ['eventId', 'date'],
    );
    return { eventId: id, date, count: dto.count };
  }

  private async hasAttendance(eventId: string): Promise<boolean> {
    const count = await this.attendanceRepo().count({
      where: { organizationId: this.orgId, eventId },
    });
    return count > 0;
  }

  private assertValidRange(from: string, to: string): void {
    if (from > to) {
      throw new BadRequestException(
        'La fecha "desde" no puede ser posterior a "hasta".',
      );
    }
    if (daysBetween(from, to) > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `El rango no puede superar los ${MAX_RANGE_DAYS} días.`,
      );
    }
  }

  private async findOrFail(id: string): Promise<OrgEvent> {
    const event = await this.repo().findOneBy({
      id,
      organizationId: this.orgId,
    });
    if (!event) {
      throw new NotFoundException('El evento no existe.');
    }
    return event;
  }

  private get orgId(): string {
    return this.tenantContext.organizationId;
  }

  private repo(): Repository<OrgEvent> {
    return this.tenantContext.getManager().getRepository(OrgEvent);
  }

  private attendanceRepo(): Repository<EventAttendance> {
    return this.tenantContext.getManager().getRepository(EventAttendance);
  }
}

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const start = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  return Math.round((end - start) / 86_400_000);
}
