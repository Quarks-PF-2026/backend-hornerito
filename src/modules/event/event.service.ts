import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { linearRegression, linearRegressionLine } from 'simple-statistics';
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
}

/** Días de asistencia registrada mínimos para proyectar (ADR-005). */
export const MIN_FORECAST_DAYS = 30;
/** Horizonte de la proyección: los N días siguientes a hoy. */
export const FORECAST_HORIZON_DAYS = 7;
/** Bajo este cambio semanal relativo al promedio, la tendencia es 'estable'. */
const STABLE_WEEKLY_CHANGE = 0.05;

export interface AttendanceForecast {
  eventId: string;
  eventName: string;
  daysRecorded: number;
  minDaysRequired: number;
  sufficientHistory: boolean;
  trend: 'sube' | 'baja' | 'estable' | null;
  forecast: { date: string; expected: number }[];
}

/**
 * Regresión lineal sobre (días desde el primer registro, asistentes).
 * Es una tendencia, no un modelo estacional: ignora el día de la semana
 * (ver ADR-005). Las fechas se restan como días de calendario UTC para que
 * el huso de la máquina no corra un día.
 */
export function forecastAttendance(
  series: { date: string; count: number }[],
  today: string,
): Pick<AttendanceForecast, 'trend' | 'forecast'> {
  if (series.length < MIN_FORECAST_DAYS) {
    return { trend: null, forecast: [] };
  }
  const first = series[0].date;
  const points = series.map((s): [number, number] => [
    daysBetween(first, s.date),
    s.count,
  ]);
  const fit = linearRegression(points);
  const slope = fit.m;
  const predict = linearRegressionLine(fit);
  const mean = points.reduce((acc, [, y]) => acc + y, 0) / points.length;

  const trend =
    Math.abs(slope) * FORECAST_HORIZON_DAYS <= STABLE_WEEKLY_CHANGE * mean
      ? 'estable'
      : slope > 0
        ? 'sube'
        : 'baja';
  const forecast = Array.from({ length: FORECAST_HORIZON_DAYS }, (_, i) => {
    const date = addDays(today, i + 1);
    return {
      date,
      expected: Math.max(0, Math.round(predict(daysBetween(first, date)))),
    };
  });
  return { trend, forecast };
}

const MAX_RANGE_DAYS = 366;
const DEFAULT_RANGE_DAYS = 29;

/**
 * ¿`date` es una ocurrencia real del evento? Periódico: todos los días desde
 * `startDate` hasta hoy o hasta la baja (`endedOn`), lo que sea antes.
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
  return date >= event.startDate && date <= upperBound;
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
    dates.push(d);
  }
  return dates;
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
        organizationId: this.orgId,
        active: true,
        endedOn: null,
      }),
    );
  }

  async update(id: string, dto: UpdateEventDto): Promise<OrgEvent> {
    const event = await this.findOrFail(id);
    const changesKindOrStartDate =
      (dto.kind !== undefined && dto.kind !== event.kind) ||
      (dto.startDate !== undefined && dto.startDate !== event.startDate);

    if (changesKindOrStartDate && (await this.hasAttendance(id))) {
      throw new ConflictException(
        'El evento ya tiene asistencia registrada: solo se puede editar el nombre, no el tipo ni la fecha de inicio.',
      );
    }

    if (dto.name !== undefined) event.name = dto.name;
    if (dto.kind !== undefined) event.kind = dto.kind;
    if (dto.startDate !== undefined) event.startDate = dto.startDate;
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

  async attendanceForecast(): Promise<AttendanceForecast[]> {
    const events = await this.repo().find({
      where: {
        organizationId: this.orgId,
        active: true,
        kind: EventKind.PERIODIC,
      },
      order: { name: 'ASC' },
    });
    const today = todayAr();
    return Promise.all(
      events.map(async (event) => {
        const rows = await this.attendanceRepo().find({
          where: { organizationId: this.orgId, eventId: event.id },
          order: { date: 'ASC' },
        });
        return {
          eventId: event.id,
          eventName: event.name,
          daysRecorded: rows.length,
          minDaysRequired: MIN_FORECAST_DAYS,
          sufficientHistory: rows.length >= MIN_FORECAST_DAYS,
          ...forecastAttendance(rows, today),
        };
      }),
    );
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
