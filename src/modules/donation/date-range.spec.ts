import { BadRequestException } from '@nestjs/common';
import { createdAtWithin, currentMonthRange } from './date-range';

/**
 * Los operadores de TypeORM guardan sus argumentos en `value`: uno solo para
 * `MoreThanOrEqual`/`LessThanOrEqual`, un par para `Between`. Son literales
 * UTC, no `Date`: la columna es `TIMESTAMP` sin zona.
 */
function bounds(operator: ReturnType<typeof createdAtWithin>): string[] {
  if (!operator) return [];
  const value = operator.value as unknown;
  return Array.isArray(value) ? (value as string[]) : [value as string];
}

describe('createdAtWithin', () => {
  it('no filtra cuando no hay ningún extremo', () => {
    expect(createdAtWithin({})).toBeUndefined();
  });

  it('arranca en la medianoche local del "desde"', () => {
    const [since] = bounds(createdAtWithin({ from: '2026-08-20' }));
    // Medianoche en Argentina son las 03:00 UTC del mismo día.
    expect(since).toBe('2026-08-20 03:00:00.000');
  });

  it('incluye el día entero del "hasta"', () => {
    const [until] = bounds(createdAtWithin({ to: '2026-08-20' }));
    // Último instante del día local: una donación de las 22:30 del 20
    // (01:30Z del 21) sigue entrando.
    expect(until).toBe('2026-08-21 02:59:59.999');
    expect('2026-08-21 01:30:00.000' < until).toBe(true);
  });

  it('combina los dos extremos', () => {
    const [since, until] = bounds(
      createdAtWithin({ from: '2026-08-01', to: '2026-08-31' }),
    );
    expect(since).toBe('2026-08-01 03:00:00.000');
    expect(until).toBe('2026-09-01 02:59:59.999');
  });

  it('acepta un rango de un solo día', () => {
    const [since, until] = bounds(
      createdAtWithin({ from: '2026-08-20', to: '2026-08-20' }),
    );
    expect(
      new Date(`${until}Z`).getTime() - new Date(`${since}Z`).getTime(),
    ).toBe(24 * 60 * 60 * 1000 - 1);
  });

  it('rechaza un "desde" posterior al "hasta"', () => {
    expect(() =>
      createdAtWithin({ from: '2026-08-31', to: '2026-08-01' }),
    ).toThrow(BadRequestException);
  });

  it('rechaza una fecha que no existe', () => {
    expect(() => createdAtWithin({ from: '2026-02-30' })).toThrow(
      BadRequestException,
    );
  });
});

describe('currentMonthRange', () => {
  /** Instante de una hora de Argentina (UTC-3 fijo). */
  const ar = (y: number, m: number, d: number, hh: number, mm = 0) =>
    new Date(Date.UTC(y, m - 1, d, hh + 3, mm));

  it('va del día 1 a las 00:00 AR al día 1 del mes siguiente a las 00:00 AR', () => {
    expect(currentMonthRange(ar(2026, 11, 8, 20))).toEqual({
      from: new Date('2026-11-01T03:00:00.000Z'),
      to: new Date('2026-12-01T03:00:00.000Z'),
    });
  });

  it('dado el día 1 a las 22:30 AR (ya día 2 en UTC), el mes en curso es el del día 1', () => {
    const now = ar(2026, 11, 1, 22, 30);
    const { from, to } = currentMonthRange(now);
    expect(from <= now && now < to).toBe(true);
    expect(from).toEqual(new Date('2026-11-01T03:00:00.000Z'));
  });

  it('dado el último día del mes anterior a las 23:59 AR (ya día 1 en UTC), no entra en el mes siguiente', () => {
    const lastNight = ar(2026, 10, 31, 23, 59);
    expect(currentMonthRange(lastNight).to).toEqual(
      new Date('2026-11-01T03:00:00.000Z'),
    );
    const { from } = currentMonthRange(ar(2026, 11, 1, 0, 0));
    expect(lastNight < from).toBe(true);
  });

  it('en enero arranca el 1 de enero y el diciembre anterior queda afuera', () => {
    expect(currentMonthRange(ar(2027, 1, 1, 0, 30))).toEqual({
      from: new Date('2027-01-01T03:00:00.000Z'),
      to: new Date('2027-02-01T03:00:00.000Z'),
    });
    // 31/12 a las 22:00 AR ya es 1/1 en UTC, pero sigue siendo diciembre.
    expect(currentMonthRange(ar(2026, 12, 31, 22))).toEqual({
      from: new Date('2026-12-01T03:00:00.000Z'),
      to: new Date('2027-01-01T03:00:00.000Z'),
    });
  });
});
