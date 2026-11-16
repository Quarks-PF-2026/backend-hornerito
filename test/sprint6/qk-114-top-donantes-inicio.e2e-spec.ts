/**
 * QK-114 · Top 10 donantes del mes en el inicio — CP-114-01 a CP-114-09
 * Casos tal como figuran en "DOC TESTEO BACK Sprint 6.pdf" (backend, capa API/DB).
 *
 * Contrato real verificado en `public.controller.ts` / `public.service.ts`
 * (`topDonors`, `countedDonations`) y `date-range.ts` (`currentMonthRange`):
 *   - `GET /public/donors/top` es público y global: se compara la respuesta
 *     entera. Vale porque la suite corre `--runInBand` contra la base efímera
 *     y cada caso borra lo suyo al cerrar (`Sandbox`).
 *   - El mes se corta sobre `createdAt` (fecha de declaración) en hora AR.
 *
 * CP-114-05: no hace falta reloj falso. Las tres donaciones se siembran con
 * `createdAt` forzado alrededor del borde del mes en curso (hora AR vs UTC);
 * la query no acota por "ahora", solo por [día 1 00:00 AR, día 1 siguiente).
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  PayingOrg,
  RankingRow,
  Sandbox,
  SeedDonation,
  Session,
  atAR,
  bootstrapApp,
  createDonor,
  createPayingOrg,
  createPendingOrg,
  lastMonth,
  seedDonation,
  topDonors,
  uniqueEmail,
} from './helpers';

describe('QK-114 · Top 10 donantes del mes en el inicio (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const sandbox = new Sandbox();

  const donor = (name: string): Promise<Session> =>
    createDonor(app, sandbox, name);

  const org = (label: string): Promise<PayingOrg> =>
    createPayingOrg(app, sandbox, label);

  const give = (
    organizationId: string,
    who: Session | null,
    amount: number,
    extra: Partial<SeedDonation> = {},
  ) =>
    seedDonation(dataSource, {
      organizationId,
      amount,
      donorUserId: who?.userId ?? null,
      ...extra,
    });

  const row = (
    position: number,
    who: Session,
    name: string,
    total: number,
  ): RankingRow => ({ position, userId: who.userId, name, total });

  async function ranking(): Promise<RankingRow[]> {
    const res = await topDonors(app).expect(200);
    return res.body as RankingRow[];
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

  it('CP-114-01 visitante sin sesión obtiene el top ordenado por monto, sin datos de contacto', async () => {
    const a = await org('A');
    const [ana, bruno, carla] = [
      await donor('Ana'),
      await donor('Bruno'),
      await donor('Carla'),
    ];
    await give(a.id, ana, 5000, { donorContact: ana.email });
    await give(a.id, bruno, 3000, { donorContact: bruno.email });
    await give(a.id, carla, 8000, { donorContact: carla.email });

    const res = await topDonors(app);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      row(1, carla, 'Carla', 8000),
      row(2, ana, 'Ana', 5000),
      row(3, bruno, 'Bruno', 3000),
    ]);
    for (const fila of res.body as RankingRow[]) {
      expect(Object.keys(fila).sort()).toEqual([
        'name',
        'position',
        'total',
        'userId',
      ]);
    }
    expect(JSON.stringify(res.body)).not.toContain('@');
  });

  it('CP-114-02 lo donado a distintas organizaciones se suma en una sola fila por donante', async () => {
    const a = await org('A');
    const b = await org('B');
    const ana = await donor('Ana');
    const bruno = await donor('Bruno');
    await give(a.id, ana, 2000);
    await give(b.id, ana, 3000);
    await give(a.id, bruno, 4000);

    expect(await ranking()).toEqual([
      row(1, ana, 'Ana', 5000),
      row(2, bruno, 'Bruno', 4000),
    ]);
  });

  it('CP-114-03 solo suman las confirmadas: la declarada suma al confirmarse en el mes en que se declaró; la rechazada nunca', async () => {
    const a = await org('A');
    const ana = await donor('Ana');
    const bruno = await donor('Bruno');
    const carla = await donor('Carla');
    await give(a.id, ana, 1000);
    const ana5000 = await give(a.id, ana, 5000, { status: 'declarada' });
    await give(a.id, bruno, 3000);
    await give(a.id, bruno, 9000, { status: 'rechazada' });
    const carla7000 = await give(a.id, carla, 7000, {
      status: 'declarada',
      createdAt: lastMonth(),
    });

    expect(await ranking()).toEqual([
      row(1, bruno, 'Bruno', 3000),
      row(2, ana, 'Ana', 1000),
    ]);

    for (const id of [ana5000, carla7000]) {
      await request(app.getHttpServer())
        .post(`/donations/monetary/${id}/confirm`)
        .set('Authorization', `Bearer ${a.ownerToken}`)
        .expect(201);
    }

    expect(await ranking()).toEqual([
      row(1, ana, 'Ana', 6000),
      row(2, bruno, 'Bruno', 3000),
    ]);
  });

  it('CP-114-04 las anónimas y las hechas sin cuenta no entran al ranking ni se atribuyen a otro', async () => {
    const a = await org('A');
    const ana = await donor('Ana Pérez');
    const bruno = await donor('Bruno');
    await give(a.id, ana, 4000, { isAnonymous: true, donorName: 'Ana Pérez' });
    await give(a.id, null, 6000, { donorName: 'Ana Pérez' });
    await give(a.id, bruno, 1000);

    const res = await topDonors(app);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([row(1, bruno, 'Bruno', 1000)]);
  });

  it('CP-114-05 el mes se corta en hora de Argentina (UTC-3) y no en UTC', async () => {
    const a = await org('A');
    const ana = await donor('Ana');
    // D1: último día del mes anterior 23:30 AR (= día 1 02:30 UTC).
    const d1 = atAR(0, 23, 30);
    // D2: día 1 00:30 AR. D3: día 1 22:30 AR (= día 2 01:30 UTC).
    const d2 = atAR(1, 0, 30);
    const d3 = atAR(1, 22, 30);
    // El borde que se prueba: en UTC, D1 ya es día 1 del mes en curso.
    expect(d1.getUTCDate()).toBe(1);
    expect(d1.getUTCMonth()).toBe(d2.getUTCMonth());
    expect(d3.getUTCDate()).toBe(2);

    await give(a.id, ana, 1000, { createdAt: d1 });
    await give(a.id, ana, 1000, { createdAt: d2 });
    await give(a.id, ana, 1000, { createdAt: d3 });

    expect(await ranking()).toEqual([row(1, ana, 'Ana', 2000)]);
  });

  it('CP-114-06 desempate: primero quien llegó antes al total, después alfabético; orden estable entre requests', async () => {
    const a = await org('A');
    // Creados en orden inverso al esperado para que el alta no ordene sola.
    const diego = await donor('Diego');
    const carla = await donor('Carla');
    const ana = await donor('Ana');
    const bruno = await donor('Bruno');
    // Bruno llega a 3000 con su última donación del día 3; Ana, del día 5.
    await give(a.id, ana, 2000, { createdAt: atAR(1, 10) });
    await give(a.id, ana, 1000, { createdAt: atAR(5, 10) });
    await give(a.id, bruno, 1500, { createdAt: atAR(2, 10) });
    await give(a.id, bruno, 1500, { createdAt: atAR(3, 10) });
    // Carla y Diego llegan a 1000 con la misma hora.
    const same = atAR(4, 15);
    await give(a.id, diego, 1000, { createdAt: same });
    await give(a.id, carla, 1000, { createdAt: same });

    const expected = [
      row(1, bruno, 'Bruno', 3000),
      row(2, ana, 'Ana', 3000),
      row(3, carla, 'Carla', 1000),
      row(4, diego, 'Diego', 1000),
    ];
    const first = await ranking();
    const second = await ranking();
    expect(first).toEqual(expected);
    expect(second).toEqual(first);
  });

  it('CP-114-07 mes sin donaciones que cumplan las condiciones devuelve [] sin error', async () => {
    const a = await org('A');
    const ana = await donor('Ana');
    const bruno = await donor('Bruno');
    await give(a.id, ana, 4000, { createdAt: lastMonth() });
    await give(a.id, bruno, 2000, { createdAt: lastMonth() });
    await give(a.id, ana, 3000, { status: 'declarada' });

    const res = await topDonors(app);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('CP-114-08 no cuenta lo donado a una organización que no está validada', async () => {
    const a = await org('A');
    const pEmail = uniqueEmail('owner-p');
    sandbox.emails.push(pEmail);
    const p = await createPendingOrg(app, pEmail);
    sandbox.orgIds.push(p.id);
    const ana = await donor('Ana');
    const bruno = await donor('Bruno');
    await give(p.id, ana, 5000);
    await give(a.id, bruno, 1000);

    const res = await topDonors(app);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([row(1, bruno, 'Bruno', 1000)]);
  });

  it('CP-114-09 con más de diez donantes se devuelven solo los diez de mayor monto', async () => {
    const a = await org('A');
    const donors: Session[] = [];
    for (let n = 1; n <= 12; n++) {
      const d = await donor(`Donante ${String(n).padStart(2, '0')}`);
      donors.push(d);
      await give(a.id, d, 100 * n);
    }

    const res = await topDonors(app);
    expect(res.status).toBe(200);
    const body = res.body as RankingRow[];
    expect(body).toHaveLength(10);
    expect(body.map((r) => r.position)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(body.map((r) => r.total)).toEqual([
      1200, 1100, 1000, 900, 800, 700, 600, 500, 400, 300,
    ]);
    const ids = body.map((r) => r.userId);
    expect(ids).not.toContain(donors[0].userId);
    expect(ids).not.toContain(donors[1].userId);
  });
});
