import { BadRequestException } from '@nestjs/common';
import {
  Between,
  FindOperator,
  LessThanOrEqual,
  MoreThanOrEqual,
} from 'typeorm';

/**
 * Rango de días para filtrar un historial. Los dos extremos son opcionales e
 * inclusivos, y llegan como 'AAAA-MM-DD' desde un `<input type="date">`.
 */
export interface DateRange {
  from?: string;
  to?: string;
}

/**
 * Argentina no usa horario de verano desde 2009, así que el offset es fijo y
 * alcanza con sumarlo para pasar de un día local a un instante UTC.
 *
 * ponytail: offset fijo. Si el país vuelve al horario de verano o la
 * plataforma sale de Argentina, esto pasa a `AT TIME ZONE` en SQL con la zona
 * de la organización.
 */
const ORG_UTC_OFFSET_HOURS = -3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Medianoche local del día, como instante UTC. */
function startOfDay(day: string): Date {
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  const instant = new Date(
    Date.UTC(year, month - 1, dayOfMonth, -ORG_UTC_OFFSET_HOURS),
  );

  // Un día inexistente no falla: JS corrige el 30 de febrero al 2 de marzo. Se
  // compara contra lo pedido para no filtrar por una fecha que nadie escribió.
  // El offset negativo mantiene el instante dentro del mismo día UTC.
  if (
    instant.getUTCFullYear() !== year ||
    instant.getUTCMonth() !== month - 1 ||
    instant.getUTCDate() !== dayOfMonth
  ) {
    throw new BadRequestException(`La fecha ${day} no existe.`);
  }
  return instant;
}

/**
 * `createdAt` es `TIMESTAMP` sin zona y la sesión de Postgres corre en UTC:
 * las filas guardan la hora UTC como si fuera local. Comparar contra un `Date`
 * lo rompe — el driver lo serializa con la zona del proceso de Node y el
 * filtro se corre esas horas. Por eso los extremos viajan como literales UTC.
 */
export function utcLiteral(instant: Date): string {
  return instant.toISOString().replace('T', ' ').replace('Z', '');
}

/** Último instante del día local, para un "hasta" inclusivo. */
function endOfDay(day: string): string {
  return utcLiteral(new Date(startOfDay(day).getTime() + MS_PER_DAY - 1));
}

/**
 * Traduce el rango de días a una condición sobre `createdAt`. El extremo `to`
 * es inclusivo para quien filtra, así que llega hasta el último milisegundo
 * del día local: una donación de las 22:30 del último día tiene que entrar
 * aunque en UTC ya sea el día siguiente.
 *
 * Devuelve `undefined` cuando no hay ningún extremo. El llamador tiene que
 * omitir la clave en ese caso: TypeORM falla si el `where` trae un `undefined`.
 */
export function createdAtWithin({
  from,
  to,
}: DateRange): FindOperator<Date> | undefined {
  if (from && to && from > to) {
    throw new BadRequestException(
      'El "desde" no puede ser posterior al "hasta".',
    );
  }

  const since = from ? utcLiteral(startOfDay(from)) : undefined;
  const until = to ? endOfDay(to) : undefined;

  let operator: FindOperator<string> | undefined;
  if (since && until) operator = Between(since, until);
  else if (since) operator = MoreThanOrEqual(since);
  else if (until) operator = LessThanOrEqual(until);

  // La propiedad se tipa como `Date`, pero lo que viaja al driver es el
  // literal de arriba. El cast es el precio de la columna sin zona.
  return operator as FindOperator<Date> | undefined;
}

/**
 * Mes calendario en curso en hora de Argentina, como instantes UTC:
 * [día 1 00:00 AR, día 1 del mes siguiente 00:00 AR). Lo usan el ranking de
 * donantes y el perfil público (DOMAIN.md §17). `now` se recibe en vez de
 * leerse adentro para que el corte de mes se pueda probar sin reloj falso.
 */
export function currentMonthRange(now: Date): { from: Date; to: Date } {
  // Corrido al reloj local, los getters UTC devuelven año y mes de Argentina.
  const local = new Date(now.getTime() + ORG_UTC_OFFSET_HOURS * 60 * 60 * 1000);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  return {
    from: new Date(Date.UTC(year, month, 1, -ORG_UTC_OFFSET_HOURS)),
    // Date.UTC normaliza el mes 12 al enero del año siguiente.
    to: new Date(Date.UTC(year, month + 1, 1, -ORG_UTC_OFFSET_HOURS)),
  };
}
