/**
 * QK-113 · Donar con la sesión iniciada — CP-113-01 a CP-113-08
 * Casos tal como figuran en "DOC TESTEO BACK Sprint 6.pdf" (backend, capa API/DB).
 *
 * Contrato real verificado en `public-monetary-donation.controller.ts`,
 * `create-monetary-donation.dto.ts`, `monetary-donation.service.ts` y
 * `optional-jwt-auth.guard.ts`:
 *   - `POST /public/organizations/:id/donations` (multipart) con sesión
 *     opcional: token válido de cuenta donante → `donorUserId`; sin token, o
 *     con uno vencido/inválido, se dona como visitante (nunca 401).
 *   - `isAnonymous` solo se guarda con sesión.
 *   - El panel (`GET /donations/monetary`, `POST …/:id/confirm`) va con
 *     TenantGuard, owner/admin.
 */
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  PayingOrg,
  RankingRow,
  Sandbox,
  Session,
  bootstrapApp,
  createDonor,
  createPayingOrg,
  declareDonation,
  donationRow,
  messagesOf,
  publicOrg,
  topDonors,
} from './helpers';

interface PanelDonation {
  id: string;
  amount: number;
  donorName: string | null;
  donorContact: string | null;
}

describe('QK-113 · Donar con la sesión iniciada (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const sandbox = new Sandbox();

  const ana = (): Promise<Session> =>
    createDonor(app, sandbox, 'Ana Pérez', { email: 'ana@mail.com' });

  const org = (label: string): Promise<PayingOrg> =>
    createPayingOrg(app, sandbox, label);

  async function panel(token: string): Promise<PanelDonation[]> {
    const res = await request(app.getHttpServer())
      .get('/donations/monetary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body as PanelDonation[];
  }

  function confirm(token: string, id: string) {
    return request(app.getHttpServer())
      .post(`/donations/monetary/${id}/confirm`)
      .set('Authorization', `Bearer ${token}`);
  }

  beforeAll(async () => {
    ({ app, dataSource } = await bootstrapApp());
  });

  afterEach(async () => {
    await sandbox.cleanup(dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('CP-113-01 donación con sesión queda asociada a la cuenta, con nombre y contacto del formulario', async () => {
    const a = await org('A');
    const donor = await ana();

    const res = await declareDonation(
      app,
      a.id,
      {
        amount: '5000',
        method: 'transferencia',
        donorName: 'Ana Pérez',
        donorContact: 'ana@mail.com',
      },
      donor.token,
    );
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('declarada');

    const row = await donationRow(dataSource, res.body.id as string);
    expect(row.donorUserId).toBe(donor.userId);
    expect(row.isAnonymous).toBe(false);
    expect(row.donorName).toBe('Ana Pérez');
    expect(row.donorContact).toBe('ana@mail.com');

    const list = await panel(a.ownerToken);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(res.body.id);
    expect(list[0].donorName).toBe('Ana Pérez');
  });

  it('CP-113-02 visitante sin sesión sigue pudiendo declarar y no queda asociado a ninguna cuenta', async () => {
    const a = await org('A');

    const d1 = await declareDonation(app, a.id, {
      amount: '2000',
      method: 'transferencia',
    });
    const d2 = await declareDonation(app, a.id, {
      amount: '3000',
      method: 'transferencia',
      donorName: 'Bruno',
      isAnonymous: 'true',
    });

    for (const res of [d1, d2]) {
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('declarada');
      const row = await donationRow(dataSource, res.body.id as string);
      expect(row.donorUserId).toBeNull();
      expect(row.isAnonymous).toBe(false);
    }
  });

  it('CP-113-03 donación anónima con sesión: asociada a la cuenta, visible en el panel, fuera de toda superficie pública', async () => {
    const a = await org('A');
    const donor = await ana();

    const res = await declareDonation(
      app,
      a.id,
      {
        amount: '4000',
        method: 'transferencia',
        donorName: 'Ana Pérez',
        donorContact: 'ana@mail.com',
        isAnonymous: 'true',
      },
      donor.token,
    );
    expect(res.status).toBe(201);
    const id = res.body.id as string;

    await confirm(a.ownerToken, id).expect(201);

    const row = await donationRow(dataSource, id);
    expect(row.donorUserId).toBe(donor.userId);
    expect(row.isAnonymous).toBe(true);

    const list = await panel(a.ownerToken);
    expect(list[0].donorName).toBe('Ana Pérez');
    expect(list[0].donorContact).toBe('ana@mail.com');

    const top = await topDonors(app).expect(200);
    expect((top.body as RankingRow[]).map((r) => r.userId)).not.toContain(
      donor.userId,
    );
    const ficha = await publicOrg(app, a.id).expect(200);
    expect(
      (ficha.body.topDonors as RankingRow[]).map((r) => r.userId),
    ).not.toContain(donor.userId);
    await request(app.getHttpServer())
      .get(`/public/donors/${donor.userId}`)
      .expect(404);
  });

  it('CP-113-04 nombre y contacto editados al donar no modifican el perfil de la cuenta', async () => {
    const a = await org('A');
    const donor = await ana();

    const res = await declareDonation(
      app,
      a.id,
      {
        amount: '1500',
        method: 'transferencia',
        donorName: 'Familia Pérez',
        donorContact: 'familia.perez@correo.test',
      },
      donor.token,
    );
    expect(res.status).toBe(201);

    const row = await donationRow(dataSource, res.body.id as string);
    expect(row.donorName).toBe('Familia Pérez');
    expect(row.donorContact).toBe('familia.perez@correo.test');
    expect(row.donorUserId).toBe(donor.userId);

    const profile = await request(app.getHttpServer())
      .get('/profile')
      .set('Authorization', `Bearer ${donor.token}`)
      .expect(200);
    expect(profile.body.name).toBe('Ana Pérez');
    expect(profile.body.email).toBe('ana@mail.com');
  });

  it('CP-113-05 la asociación no es retroactiva: donación sin sesión con el nombre y correo de una cuenta no se le atribuye', async () => {
    const a = await org('A');
    const donor = await ana();

    const res = await declareDonation(app, a.id, {
      amount: '2500',
      method: 'transferencia',
      donorName: 'Ana Pérez',
      donorContact: 'ana@mail.com',
    });
    expect(res.status).toBe(201);
    await confirm(a.ownerToken, res.body.id as string).expect(201);

    const row = await donationRow(dataSource, res.body.id as string);
    expect(row.status).toBe('confirmada');
    expect(row.donorUserId).toBeNull();

    const top = await topDonors(app).expect(200);
    expect((top.body as RankingRow[]).map((r) => r.userId)).not.toContain(
      donor.userId,
    );
    const perfil = await request(app.getHttpServer()).get(
      `/public/donors/${donor.userId}`,
    );
    expect(perfil.status).toBe(404);
    expect(messagesOf(perfil.body)).toContain('El donante no existe.');
  });

  it('CP-113-06 aislamiento: cada organización ve en su historial solo la donación que recibió', async () => {
    const a = await org('A');
    const b = await org('B');
    const donor = await ana();

    const toA = await declareDonation(
      app,
      a.id,
      { amount: '1000', method: 'transferencia' },
      donor.token,
    );
    const toB = await declareDonation(
      app,
      b.id,
      { amount: '2000', method: 'transferencia' },
      donor.token,
    );
    expect(toA.status).toBe(201);
    expect(toB.status).toBe(201);
    for (const res of [toA, toB]) {
      const row = await donationRow(dataSource, res.body.id as string);
      expect(row.donorUserId).toBe(donor.userId);
    }

    const listA = await panel(a.ownerToken);
    const listB = await panel(b.ownerToken);
    expect(listA.map((d) => [d.id, d.amount])).toEqual([[toA.body.id, 1000]]);
    expect(listB.map((d) => [d.id, d.amount])).toEqual([[toB.body.id, 2000]]);
  });

  it('CP-113-07 con token vencido o inválido se dona como visitante: 201 (no 401) y sin cuenta asociada', async () => {
    const a = await org('A');
    const donor = await ana();

    const expired = app
      .get(JwtService, { strict: false })
      .sign({ sub: donor.userId, email: donor.email }, { expiresIn: -60 });
    const [header, payload, signature] = donor.token.split('.');
    const badSignature = `${header}.${payload}.${signature
      .split('')
      .reverse()
      .join('')}`;
    expect(badSignature).not.toBe(donor.token);

    for (const token of [expired, badSignature]) {
      const res = await declareDonation(
        app,
        a.id,
        { amount: '1200', method: 'transferencia', isAnonymous: 'true' },
        token,
      );
      expect(res.status).toBe(201);
      const row = await donationRow(dataSource, res.body.id as string);
      expect(row.donorUserId).toBeNull();
      expect(row.isAnonymous).toBe(false);
    }
  });

  it('CP-113-08 isAnonymous inválido responde 400 con su mensaje y no crea la donación', async () => {
    const a = await org('A');
    const donor = await ana();

    for (const value of ['quizás', '1']) {
      const res = await declareDonation(
        app,
        a.id,
        { amount: '1000', method: 'transferencia', isAnonymous: value },
        donor.token,
      );
      expect(res.status).toBe(400);
      expect(messagesOf(res.body)).toContain(
        'Indicá si la donación es anónima con sí o no.',
      );
    }

    const [{ count }]: Array<{ count: string }> = await dataSource.query(
      `SELECT COUNT(*) AS count FROM donations WHERE "organizationId" = $1`,
      [a.id],
    );
    expect(Number(count)).toBe(0);
  });
});
