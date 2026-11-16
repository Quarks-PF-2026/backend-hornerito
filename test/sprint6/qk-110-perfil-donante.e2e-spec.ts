/**
 * QK-110 · Consultar perfil de otro usuario — CP-110-01 a CP-110-04
 * Casos tal como figuran en "DOC TESTEO BACK Sprint 6.pdf" (backend, capa API/DB).
 *
 * Contrato real verificado en `public.controller.ts` / `public.service.ts`
 * (`getDonor`): `GET /public/donors/:userId` es público, valida uuid
 * (`ParseUUIDPipe`) y suma con las mismas reglas que el ranking; sin ninguna
 * donación que cuente responde 404 "El donante no existe.".
 */
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  Sandbox,
  bootstrapApp,
  createDonor,
  createPayingOrg,
  createPendingOrg,
  lastMonth,
  messagesOf,
  seedDonation,
  uniqueEmail,
} from './helpers';

describe('QK-110 · Consultar perfil de otro usuario (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const sandbox = new Sandbox();

  const perfil = (id: string) =>
    request(app.getHttpServer()).get(`/public/donors/${id}`);

  beforeAll(async () => {
    ({ app, dataSource } = await bootstrapApp());
  });

  afterEach(async () => {
    await sandbox.cleanup(dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('CP-110-01 visitante sin cuenta ve nombre, alta de la cuenta, monto del mes y total', async () => {
    const a = await createPayingOrg(app, sandbox, 'A');
    const b = await createPayingOrg(app, sandbox, 'B');
    const ana = await createDonor(app, sandbox, 'Ana Pérez', {
      createdAt: '2025-03-10T15:00:00Z',
    });
    await seedDonation(dataSource, {
      organizationId: a.id,
      amount: 3000,
      donorUserId: ana.userId,
    });
    await seedDonation(dataSource, {
      organizationId: b.id,
      amount: 2000,
      donorUserId: ana.userId,
      createdAt: lastMonth(),
    });

    const res = await perfil(ana.userId);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Ana Pérez');
    expect((res.body.memberSince as string).slice(0, 7)).toBe('2025-03');
    expect(res.body.monthTotal).toBe(3000);
    expect(res.body.totalAmount).toBe(5000);
  });

  it('CP-110-02 el perfil no expone datos de contacto ni las organizaciones a las que donó', async () => {
    const a = await createPayingOrg(app, sandbox, 'A');
    const ana = await createDonor(app, sandbox, 'Ana Pérez', {
      phone: '353 444-5566',
    });
    await seedDonation(dataSource, {
      organizationId: a.id,
      amount: 1000,
      donorUserId: ana.userId,
      donorContact: ana.email,
    });

    const res = await perfil(ana.userId).expect(200);
    expect(Object.keys(res.body as object).sort()).toEqual([
      'memberSince',
      'monthTotal',
      'name',
      'totalAmount',
      'userId',
    ]);
    const crudo = JSON.stringify(res.body);
    expect(crudo).not.toContain(ana.email);
    expect(crudo).not.toContain('353 444-5566');
    expect(crudo).not.toContain(a.id);
    expect(crudo).not.toContain(a.name);
  });

  it('CP-110-03 el perfil suma solo lo confirmado, no anónimo y a organizaciones validadas', async () => {
    const a = await createPayingOrg(app, sandbox, 'A');
    const pEmail = uniqueEmail('owner-p');
    sandbox.emails.push(pEmail);
    const p = await createPendingOrg(app, pEmail);
    sandbox.orgIds.push(p.id);
    const ana = await createDonor(app, sandbox, 'Ana Pérez');
    const base = { organizationId: a.id, donorUserId: ana.userId };
    await seedDonation(dataSource, { ...base, amount: 1000 });
    await seedDonation(dataSource, {
      ...base,
      amount: 2000,
      isAnonymous: true,
    });
    await seedDonation(dataSource, {
      ...base,
      amount: 3000,
      status: 'declarada',
    });
    await seedDonation(dataSource, {
      ...base,
      amount: 4000,
      status: 'rechazada',
    });
    await seedDonation(dataSource, {
      organizationId: p.id,
      donorUserId: ana.userId,
      amount: 5000,
    });

    const res = await perfil(ana.userId);
    expect(res.status).toBe(200);
    expect(res.body.monthTotal).toBe(1000);
    expect(res.body.totalAmount).toBe(1000);
  });

  it('CP-110-04 perfil no disponible: cuenta sin donaciones públicas, id inexistente e id mal formado', async () => {
    const a = await createPayingOrg(app, sandbox, 'A');
    const bruno = await createDonor(app, sandbox, 'Bruno');
    const base = { organizationId: a.id, donorUserId: bruno.userId };
    await seedDonation(dataSource, {
      ...base,
      amount: 2000,
      isAnonymous: true,
    });
    await seedDonation(dataSource, {
      ...base,
      amount: 1000,
      status: 'declarada',
    });

    for (const id of [bruno.userId, randomUUID()]) {
      const res = await perfil(id);
      expect(res.status).toBe(404);
      expect(messagesOf(res.body)).toContain('El donante no existe.');
    }

    const malFormado = await perfil('abc');
    expect(malFormado.status).toBe(400);
  });
});
