/**
 * "Hoy" en Argentina, compartido por todo lo que necesita el día de calendario
 * del negocio en vez del huso del servidor (Neon y Vercel corren en UTC:
 * cerca de la medianoche UTC "hoy" ya cambió). Nace en `PublicService`
 * (vencimiento de necesidades) y lo reusa `EventService` (ocurrencias y
 * asistencia) para que las dos lecturas no puedan desincronizarse en el día.
 */
export const TODAY_AR_TZ = 'America/Argentina/Cordoba';

/** Fragmento SQL: "hoy" en Argentina, para usar en un `WHERE` o `SELECT`. */
export const TODAY_AR = `(now() AT TIME ZONE '${TODAY_AR_TZ}')::date`;

/** 'YYYY-MM-DD' de hoy en Argentina, calculado en TS (mismo criterio que `TODAY_AR`). */
export function todayAr(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TODAY_AR_TZ }).format(
    new Date(),
  );
}

/**
 * Normaliza una fecha de Postgres a 'YYYY-MM-DD' sin pasar por UTC: pg
 * entrega columnas `date` como medianoche local, y `toISOString()` las
 * corre un día para atrás en husos al oeste de UTC (o adelante, al este).
 */
export function toIsoDate(value: Date | string): string {
  if (!(value instanceof Date)) {
    return value;
  }
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}
