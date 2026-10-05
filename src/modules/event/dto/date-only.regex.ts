/**
 * Fecha sola, sin hora ni semana ISO. `@IsDateString({strict:true})` valida
 * el calendario (rechaza 30 de febrero) pero igual deja pasar datetimes
 * ('2026-01-01T03:00:00Z'), el formato básico ('20260101') y semanas ISO
 * ('2026-W01') porque las tres son ISO 8601 válidas. Este regex es el que
 * de verdad restringe el formato a 'AAAA-MM-DD'.
 */
export const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Hora 'HH:MM' en 24 h (00:00 a 23:59), sin segundos. */
export const TIME_HH_MM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
