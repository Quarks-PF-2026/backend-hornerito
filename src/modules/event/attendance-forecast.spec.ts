import { forecastAttendance } from './event.service';

const TODAY = '2026-10-05';

/** `n` días terminando hoy, con `inicial + paso * i`. */
function serie(n: number, inicial: number, paso: number) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 9, 5 - (n - 1) + i));
    return { date: d.toISOString().slice(0, 10), count: inicial + paso * i };
  });
}

describe('forecastAttendance', () => {
  it('Dado menos de 30 días registrados, Cuando se proyecta, Entonces no hay tendencia ni pronóstico', () => {
    expect(forecastAttendance(serie(29, 50, 1), TODAY)).toEqual({
      trend: null,
      forecast: [],
    });
  });

  it('Dada una serie creciente, Cuando se proyecta, Entonces la tendencia sube y los 7 días siguientes siguen la recta', () => {
    const { trend, forecast } = forecastAttendance(serie(30, 40, 2), TODAY);
    expect(trend).toBe('sube');
    expect(forecast.map((f) => f.date)).toEqual([
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
      '2026-10-12',
    ]);
    expect(forecast.map((f) => f.expected)).toEqual([
      100, 102, 104, 106, 108, 110, 112,
    ]);
  });

  it('Dada una serie plana, Cuando se proyecta, Entonces la tendencia es estable', () => {
    const { trend, forecast } = forecastAttendance(serie(30, 50, 0), TODAY);
    expect(trend).toBe('estable');
    expect(forecast.every((f) => f.expected === 50)).toBe(true);
  });

  it('Dada una serie decreciente, Cuando se proyecta, Entonces la tendencia baja', () => {
    expect(forecastAttendance(serie(40, 100, -1), TODAY).trend).toBe('baja');
  });

  it('Dada una caída que llevaría a negativos, Cuando se proyecta, Entonces el pronóstico tiene piso en 0', () => {
    const { forecast } = forecastAttendance(serie(30, 30, -1), TODAY);
    expect(forecast.every((f) => f.expected >= 0)).toBe(true);
    expect(forecast[6].expected).toBe(0);
  });
});
