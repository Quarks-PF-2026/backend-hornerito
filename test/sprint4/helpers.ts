/**
 * Utilidades específicas de la trazabilidad QA del Sprint 4 (carpeta
 * `test/sprint4`). Reexporta lo común de `test/sprint2/helpers.ts`
 * (bootstrapApp, registerAndLogin, createOrganization, createPlatformAdmin,
 * switchOrg, cleanup*, uniqueEmail, DEFAULT_PASSWORD) y agrega solo lo que
 * las historias QK-18/QK-19/QK-11 necesitan y que sprint2 no cubre:
 * registrar SIN verificar, leer/forzar tokens de verificación por SQL, y
 * crear una organización que se queda en `pending` (sin el atajo de
 * `createOrganization`, que la valida).
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';

export * from '../sprint2/helpers';
import { DEFAULT_PASSWORD, registerAndLogin } from '../sprint2/helpers';

export interface RawRegisterResult {
  status: number;
  body: { email?: string; message?: unknown };
}

/**
 * Registra un usuario tal cual `POST /auth/register`, SIN pasar por el
 * verify — a diferencia de `registerAndLogin` (sprint2), que verifica de
 * entrada. Varios casos de QK-18 (CP-18-02 a 05, 08) necesitan la cuenta
 * todavía sin verificar.
 */
export async function rawRegister(
  app: INestApplication,
  email: string,
  password = DEFAULT_PASSWORD,
  name = 'Usuario de prueba',
): Promise<RawRegisterResult> {
  const res = await request(app.getHttpServer()).post('/auth/register').send({
    name,
    email,
    password,
    confirmPassword: password,
    acceptedTerms: true,
  });
  return { status: res.status, body: res.body as RawRegisterResult['body'] };
}

export interface UserTokenRow {
  verificationToken: string | null;
  verificationTokenExpiresAt: Date | null;
  emailVerified: boolean;
}

export async function getUserTokenRow(
  dataSource: DataSource,
  email: string,
): Promise<UserTokenRow> {
  const [row] = await dataSource.query<UserTokenRow[]>(
    `SELECT "verificationToken", "verificationTokenExpiresAt", "emailVerified"
     FROM users WHERE email = $1`,
    [email],
  );
  return row;
}

/** Fuerza el vencimiento del token de verificación vigente (CP-18-03). */
export async function expireVerificationToken(
  dataSource: DataSource,
  email: string,
): Promise<void> {
  await dataSource.query(
    `UPDATE users SET "verificationTokenExpiresAt" = now() - interval '1 hour'
     WHERE email = $1`,
    [email],
  );
}

export interface PendingOrganization {
  id: string;
  status: string;
  ownerToken: string;
  ownerEmail: string;
}

/**
 * Crea una organización que se queda en `pending` (el estado real con el que
 * nace toda organización nueva — ver `organization.entity.ts`). A diferencia
 * de `createOrganization` (sprint2), que la fuerza a `validated` por SQL
 * porque esa es la precondición de la mayoría de las otras historias, QK-19
 * necesita organizaciones específicamente pendientes para ejercitar el panel
 * de validación.
 */
export async function createPendingOrganization(
  app: INestApplication,
  ownerEmail: string,
  overrides: Partial<{
    name: string;
    description: string;
    address: string;
    contact: string;
  }> = {},
): Promise<PendingOrganization> {
  const owner = await registerAndLogin(app, ownerEmail);
  const res = await request(app.getHttpServer())
    .put('/organization/me')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({
      name: 'Comedor Amanecer',
      description: 'Brindamos desayuno y merienda a la comunidad del barrio.',
      address: 'Av. Italia 980, Villa María, Córdoba',
      contact: '353 455-1122',
      ...overrides,
    })
    .expect(200);
  const org = res.body as { id: string; status: string };
  return {
    id: org.id,
    status: org.status,
    ownerToken: owner.token,
    ownerEmail,
  };
}

export async function getOrganizationRow(
  dataSource: DataSource,
  id: string,
): Promise<{ status: string; rejectReason: string | null } | undefined> {
  const [row] = await dataSource.query<
    { status: string; rejectReason: string | null }[]
  >(`SELECT status, "rejectReason" FROM organizations WHERE id = $1`, [id]);
  return row;
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
