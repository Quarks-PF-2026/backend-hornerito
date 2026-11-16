/**
 * Utilidades de la trazabilidad QA del Sprint 6 (carpeta `test/sprint6`).
 * Reexporta lo de `test/sprint5/helpers.ts` (y por transitividad sprint2) y
 * agrega lo que QK-113/114/115/111/110 necesitan:
 *
 *   - donantes con nombre propio (cuenta `donor`, insertada ya verificada: el
 *     ranking necesita una docena y lo que se prueba no es el alta);
 *   - organizaciones validadas con datos de cobro;
 *   - donaciones económicas sembradas por SQL con `createdAt` forzado (el
 *     corte de mes y el desempate miran la fecha de declaración, que la API
 *     no deja fijar);
 *   - fechas en hora de Argentina (UTC-3 fijo, igual que `date-range.ts`);
 *   - bootstrap con el Cloudinary simulado del repo (`fake-cloudinary.ts`).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { CloudinaryService } from '../../src/modules/media/cloudinary.service';
import { FakeCloudinary } from '../acceptance/support/fake-cloudinary';
import {
  DEFAULT_PASSWORD,
  Session,
  cleanupOrganizations,
  cleanupUsers,
  createOrganization,
  registerAndLogin,
  switchOrg,
  uniqueEmail,
} from '../sprint5/helpers';

export * from '../sprint5/helpers';
export { FakeCloudinary };

/** Mismo bootstrap que `bootstrapApp`, con Cloudinary reemplazado por el fake. */
export async function bootstrapAppWithFakeCloudinary(): Promise<{
  app: INestApplication;
  dataSource: DataSource;
  cloudinary: FakeCloudinary;
}> {
  const cloudinary = new FakeCloudinary();
  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CloudinaryService)
    .useValue(cloudinary)
    .compile();
  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return { app, dataSource: app.get(DataSource), cloudinary };
}

/** Lo creado por un caso, para borrarlo al cerrar (los rankings son globales). */
export class Sandbox {
  readonly emails: string[] = [];
  readonly orgIds: string[] = [];

  async cleanup(dataSource: DataSource): Promise<void> {
    await cleanupOrganizations(dataSource, this.orgIds);
    await cleanupUsers(dataSource, this.emails);
    this.orgIds.length = 0;
    this.emails.length = 0;
  }
}

export async function login(
  app: INestApplication,
  email: string,
): Promise<Session> {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: DEFAULT_PASSWORD })
    .expect(200);
  const body = res.body as { accessToken: string; user: { id: string } };
  return { token: body.accessToken, userId: body.user.id, email };
}

let passwordHash: Promise<string> | undefined;

/** Cuenta de donante (`accountType` default 'donor') con nombre propio. */
export async function createDonor(
  app: INestApplication,
  sandbox: Sandbox,
  name: string,
  opts: { email?: string; phone?: string; createdAt?: string } = {},
): Promise<Session> {
  const dataSource = app.get(DataSource);
  const email = opts.email ?? uniqueEmail('donante');
  // Un email literal del doc (ana@mail.com) puede haber quedado de una corrida
  // abortada: la base es la efímera de test.
  await dataSource.query(`DELETE FROM users WHERE email = $1`, [email]);
  passwordHash ??= bcrypt.hash(DEFAULT_PASSWORD, 4);
  await dataSource.query(
    `INSERT INTO users (name, email, phone, "passwordHash", "emailVerified", "termsAcceptedAt")
     VALUES ($1, $2, $3, $4, true, now())`,
    [name, email, opts.phone ?? null, await passwordHash],
  );
  if (opts.createdAt) {
    await dataSource.query(
      `UPDATE users SET "createdAt" = $1 WHERE email = $2`,
      [opts.createdAt, email],
    );
  }
  sandbox.emails.push(email);
  return login(app, email);
}

export interface PayingOrg {
  id: string;
  name: string;
  /** Token del owner ya scopeado a la organización. */
  ownerToken: string;
  ownerId: string;
}

/** Organización validada; con `paymentAlias` salvo que se pida lo contrario. */
export async function createPayingOrg(
  app: INestApplication,
  sandbox: Sandbox,
  label: string,
  withPayment = true,
): Promise<PayingOrg> {
  const email = uniqueEmail(`owner-${label}`);
  sandbox.emails.push(email);
  const owner = await registerAndLogin(app, email);
  const name = `Org ${label} ${Date.now()}`;
  const org = await createOrganization(app, owner.token, { name });
  sandbox.orgIds.push(org.id);
  if (withPayment) {
    await app.get(DataSource).query(
      `UPDATE organizations
            SET "paymentAlias" = $1, "paymentHolder" = $2, "paymentBank" = 'Banco Nación'
          WHERE id = $3`,
      [`qa.s6.${label}.${Date.now()}`.toLowerCase(), name, org.id],
    );
  }
  const ownerToken = await switchOrg(app, owner.token, org.id);
  return { id: org.id, name, ownerToken, ownerId: owner.userId };
}

/** Año y mes (1-12) en curso en hora de Argentina. */
export function arMonth(): { year: number; month: number } {
  const [year, month] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  })
    .format(new Date())
    .split('-')
    .map(Number);
  return { year, month };
}

/**
 * Instante de "día `day` a las hh:mm hora AR" del mes en curso (o corrido
 * `monthOffset` meses). Día 0 = último día del mes anterior.
 */
export function atAR(day: number, hh = 12, mm = 0, monthOffset = 0): Date {
  const { year, month } = arMonth();
  return new Date(Date.UTC(year, month - 1 + monthOffset, day, hh + 3, mm));
}

/** Mediodía AR del 15 del mes anterior. */
export function lastMonth(): Date {
  return atAR(15, 12, 0, -1);
}

export interface SeedDonation {
  organizationId: string;
  amount: number;
  donorUserId: string | null;
  donorName?: string | null;
  donorContact?: string | null;
  status?: 'declarada' | 'confirmada' | 'rechazada';
  isAnonymous?: boolean;
  createdAt?: Date;
}

/**
 * Inserta una donación económica directo en la base (precondición de los
 * rankings). `createdAt` es `timestamp` sin zona escrito en UTC: va como ISO
 * y se convierte explícito para que no dependa del huso del proceso.
 */
export async function seedDonation(
  dataSource: DataSource,
  d: SeedDonation,
): Promise<string> {
  const status = d.status ?? 'confirmada';
  const createdAt = (d.createdAt ?? new Date()).toISOString();
  const rows: Array<{ id: string }> = await dataSource.query(
    `INSERT INTO donations
       ("organizationId", kind, amount, status, method, "donorName", "donorContact",
        "donorUserId", "isAnonymous", "createdAt", "decidedAt", "rejectReason")
     VALUES ($1, 'economica', $2, $3, 'transferencia', $4, $5, $6, $7,
             ($8::timestamptz AT TIME ZONE 'UTC'), $9, $10)
     RETURNING id`,
    [
      d.organizationId,
      d.amount,
      status,
      d.donorName ?? null,
      d.donorContact ?? null,
      d.donorUserId,
      d.isAnonymous ?? false,
      createdAt,
      status === 'declarada' ? null : createdAt,
      status === 'rechazada' ? 'No figura en el extracto.' : null,
    ],
  );
  return rows[0].id;
}

/** Declara una donación por la vía pública (multipart), con o sin token. */
export function declareDonation(
  app: INestApplication,
  organizationId: string,
  fields: Record<string, string>,
  token?: string,
) {
  let req = request(app.getHttpServer()).post(
    `/public/organizations/${organizationId}/donations`,
  );
  if (token) req = req.set('Authorization', `Bearer ${token}`);
  for (const [key, value] of Object.entries(fields)) {
    req = req.field(key, value);
  }
  return req;
}

export interface DonationRow {
  donorUserId: string | null;
  isAnonymous: boolean;
  donorName: string | null;
  donorContact: string | null;
  status: string;
}

export async function donationRow(
  dataSource: DataSource,
  id: string,
): Promise<DonationRow> {
  const rows: DonationRow[] = await dataSource.query(
    `SELECT "donorUserId", "isAnonymous", "donorName", "donorContact", status
       FROM donations WHERE id = $1`,
    [id],
  );
  return rows[0];
}

export interface RankingRow {
  position: number;
  userId: string;
  name: string;
  total: number;
}

export function topDonors(app: INestApplication) {
  return request(app.getHttpServer()).get('/public/donors/top');
}

export function publicOrg(app: INestApplication, organizationId: string) {
  return request(app.getHttpServer()).get(
    `/public/organizations/${organizationId}`,
  );
}
