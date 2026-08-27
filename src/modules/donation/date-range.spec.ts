import { BadRequestException } from '@nestjs/common';
import { createdAtWithin } from './date-range';

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
    expect(new Date(`${until}Z`).getTime() - new Date(`${since}Z`).getTime()).toBe(
      24 * 60 * 60 * 1000 - 1,
    );
  });

  it('rechaza un "desde" posterior al "hasta"', () => {
    expect(() => createdAtWithin({ from: '2026-08-31', to: '2026-08-01' })).toThrow(
      BadRequestException,
    );
  });

  it('rechaza una fecha que no existe', () => {
    expect(() => createdAtWithin({ from: '2026-02-30' })).toThrow(BadRequestException);
  });
});
