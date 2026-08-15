/**
 * Utilidades compartidas por los specs de trazabilidad del Sprint 2
 * (carpeta `test/sprint2`). Cada archivo bootstrapea su propia instancia de
 * Nest (mismo patrón que `test/tenant-isolation.e2e-spec.ts`) para poder
 * correr en forma aislada.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

export interface Session {
  token: string;
  userId: string;
  email: string;
}

export const DEFAULT_PASSWORD = 'password1';

export async function bootstrapApp(): Promise<{
  app: INestApplication;
  dataSource: DataSource;
}> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  return { app, dataSource: app.get(DataSource) };
}

export async function registerAndLogin(
  app: INestApplication,
  email: string,
  password = DEFAULT_PASSWORD,
): Promise<Session> {
  await request(app.getHttpServer()).post('/auth/register').send({
    name: 'Usuario de prueba',
    email,
    password,
    confirmPassword: password,
    acceptedTerms: true,
  });

  // El login exige la cuenta verificada, así que recorremos el flujo real:
  // el token solo vive en la base porque en producción viaja por correo.
  const [{ verificationToken }] = (await app
    .get(DataSource)
    .query(`SELECT "verificationToken" FROM users WHERE email = $1`, [
      email,
    ])) as { verificationToken: string }[];
  await request(app.getHttpServer())
    .get('/auth/verify')
    .query({ token: verificationToken })
    .expect(200);

  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password })
    .expect(200);

  const body = res.body as {
    accessToken: string;
    user: { id: string; email: string };
  };
  return { token: body.accessToken, userId: body.user.id, email };
}

/**
 * Crea una organización y la valida directamente en la base (bypasseando el
 * flujo real de `/admin/organizations/:id/validate`, que es lo que prueba
 * QK-13 puntualmente). El resto de las historias (QK-12, QK-15, QK-26) la
 * dan como precondición ya cumplida — así lo dice el propio PDF ("La
 * organización está registrada y validada") — y no son las que ejercitan el
 * flujo de validación en sí.
 */
export async function createOrganization(
  app: INestApplication,
  token: string,
  overrides: Partial<{
    name: string;
    description: string;
    address: string;
    contact: string;
  }> = {},
): Promise<{ id: string; status: string }> {
  const res = await request(app.getHttpServer())
    .put('/organization/me')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: 'Comedor Manos del Barrio',
      description: 'Brindamos almuerzo y merienda a más de 80 chicos.',
      address: 'Bv. Sarmiento 1450, Villa María, Córdoba',
      contact: '353 412-7788',
      ...overrides,
    })
    .expect(200);
  const org = res.body as { id: string; status: string };

  const dataSource = app.get(DataSource);
  await dataSource.query(
    `UPDATE organizations SET status = 'validated' WHERE id = $1`,
    [org.id],
  );

  return { ...org, status: 'validated' };
}

/**
 * Registra un usuario y lo promueve a platform admin directo en la base
 * (no hay alta self-service, ver la migración `AddPlatformAdmin`).
 */
export async function createPlatformAdmin(
  app: INestApplication,
  email: string,
): Promise<Session> {
  const session = await registerAndLogin(app, email);
  const dataSource = app.get(DataSource);
  await dataSource.query(
    `UPDATE users SET "isPlatformAdmin" = true WHERE id = $1`,
    [session.userId],
  );
  return session;
}

export async function switchOrg(
  app: INestApplication,
  token: string,
  organizationId: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/switch-org')
    .set('Authorization', `Bearer ${token}`)
    .send({ organizationId })
    .expect(200);
  return (res.body as { accessToken: string }).accessToken;
}

export async function cleanupOrganizations(
  dataSource: DataSource,
  orgIds: string[],
): Promise<void> {
  if (orgIds.length === 0) return;
  // Todas las tablas del tenant cuelgan de `organizations` con ON DELETE
  // CASCADE, así que borrar la organización se lleva sus datos.
  await dataSource.query(`DELETE FROM organizations WHERE id = ANY($1)`, [
    orgIds,
  ]);
}

export async function cleanupUsers(
  dataSource: DataSource,
  emails: string[],
): Promise<void> {
  if (emails.length === 0) return;
  await dataSource.query(`DELETE FROM users WHERE email = ANY($1)`, [emails]);
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.com`;
}
