/**
 * Utilidades específicas de la trazabilidad QA del Sprint 5 (carpeta
 * `test/sprint5`). Reexporta lo común de `test/sprint2/helpers.ts`
 * (bootstrapApp, registerAndLogin, createOrganization, switchOrg, cleanup*,
 * uniqueEmail) y agrega lo que QK-112/QK-109/QK-108/QK-117/QK-116 necesitan
 * y que sprint2 no cubre: fechas en huso Argentina, organizaciones pending
 * crudas (sin el atajo que las valida), membresías de rol no-owner por SQL,
 * y backdating de deadlines (la API ya no deja crear una necesidad vencida,
 * ver `NeedService.assertDeadlineNotPast`).
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';

export * from '../sprint2/helpers';
import { registerAndLogin } from '../sprint2/helpers';

const TZ = 'America/Argentina/Cordoba';

/** 'YYYY-MM-DD' de hoy en Argentina — mismo criterio que `todayAr()` del backend. */
export function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

/** Suma (o resta) días de calendario a una fecha 'YYYY-MM-DD'. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Día de la semana (0=domingo…6=sábado) de una fecha 'YYYY-MM-DD'. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * El body de error de Nest puede traer `message` como string o como array
 * (uno por constraint fallado). Normaliza para poder buscar una frase
 * puntual sin importar la forma.
 */
export function messagesOf(body: unknown): string[] {
  const message = (body as { message?: unknown })?.message;
  if (Array.isArray(message)) return message as string[];
  if (typeof message === 'string') return [message];
  return [];
}

export interface PendingOrg {
  id: string;
  ownerToken: string;
  ownerEmail: string;
}

/**
 * Crea una organización que se queda en `pending` (a diferencia de
 * `createOrganization` de sprint2, que la fuerza a `validated` por SQL).
 * CP-109-08 necesita específicamente una organización sin validar.
 */
export async function createPendingOrg(
  app: INestApplication,
  ownerEmail: string,
  overrides: Partial<{
    name: string;
    description: string;
    address: string;
    contact: string;
  }> = {},
): Promise<PendingOrg> {
  const owner = await registerAndLogin(app, ownerEmail);
  const res = await request(app.getHttpServer())
    .put('/organization/me')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({
      name: 'Comedor QA Pendiente',
      description: 'Descripción de prueba.',
      address: 'Dirección de prueba 123',
      contact: '353 000-0000',
      ...overrides,
    })
    .expect(200);
  const org = res.body as { id: string };
  return { id: org.id, ownerToken: owner.token, ownerEmail };
}

export async function setOrgStatus(
  dataSource: DataSource,
  organizationId: string,
  status: 'pending' | 'validated' | 'rejected',
): Promise<void> {
  await dataSource.query(`UPDATE organizations SET status = $1 WHERE id = $2`, [
    status,
    organizationId,
  ]);
}

export async function setOrgLocality(
  dataSource: DataSource,
  organizationId: string,
  locality: string | null,
  province: string | null = null,
  country: string | null = 'Argentina',
): Promise<void> {
  await dataSource.query(
    `UPDATE organizations SET locality = $1, province = $2, country = $3 WHERE id = $4`,
    [locality, province, country, organizationId],
  );
}

/** Suma un miembro con un rol no-owner directo en la base (ver qk-116-117-events.e2e-spec.ts). */
export async function addMembership(
  dataSource: DataSource,
  userId: string,
  organizationId: string,
  role: 'admin' | 'coordinador' | 'voluntario',
): Promise<void> {
  await dataSource.query(
    `INSERT INTO organization_memberships ("userId", "organizationId", role, active)
     VALUES ($1, $2, $3, true)`,
    [userId, organizationId, role],
  );
}

/** Mueve el deadline de una necesidad directo en la base (la API rechaza fechas pasadas). */
export async function backdateNeedDeadline(
  dataSource: DataSource,
  needId: string,
  deadline: string,
): Promise<void> {
  await dataSource.query(`UPDATE needs SET deadline = $1 WHERE id = $2`, [
    deadline,
    needId,
  ]);
}

/**
 * Da de baja un evento con un `endedOn` puntual, directo en la base: la API
 * (`PATCH /events/:id/deactivate`) siempre pone la fecha de hoy, así que no
 * hay forma de simular "se dio de baja hace 2 días" más que escribiéndolo.
 */
export async function deactivateEventOn(
  dataSource: DataSource,
  eventId: string,
  endedOn: string,
): Promise<void> {
  await dataSource.query(
    `UPDATE events SET active = false, "endedOn" = $1 WHERE id = $2`,
    [endedOn, eventId],
  );
}
