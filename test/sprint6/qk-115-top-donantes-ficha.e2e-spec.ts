/**
 * QK-115 · Top donantes del mes en la ficha de la organización — CP-115-01 a CP-115-07
 * Casos tal como figuran en "DOC TESTEO BACK Sprint 6.pdf" (backend, capa API/DB).
 *
 * Contrato real verificado en `public.service.ts` (`getOrganization`,
 * `topDonors(organizationId)`):
 *   - `GET /public/organizations/:id` trae `topDonors` (top 5 del mes, solo lo
 *     donado a esa organización) y `donations.acceptsMonetary`.
 *   - Sin `paymentAlias` no hay top, igual que no hay bloque de donar dinero.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  SupplyCategory,
  SupplyUnit,
} from '../../src/modules/supply/entities/supply.entity';
import {
  PayingOrg,
  RankingRow,
  Sandbox,
  SeedDonation,
  Session,
  addDays,
  bootstrapApp,
  createDonor,
  createPayingOrg,
  lastMonth,
  publicOrg,
  seedDonation,
  today,
  topDonors,
} from './helpers';

describe('QK-115 · Top donantes del mes en la ficha de la organización (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const sandbox = new Sandbox();

  const donor = (name: string): Promise<Session> =>
    createDonor(app, sandbox, name);

  const org = (label: string): Promise<PayingOrg> =>
    createPayingOrg(app, sandbox, label);

  const give = (
    organizationId: string,
    who: Session,
    amount: number,
    extra: Partial<SeedDonation> = {},
  ) =>
    seedDonation(dataSource, {
      organizationId,
      amount,
      donorUserId: who.userId,
      donorContact: who.email,
      ...extra,
    });

  const row = (
    position: number,
    who: Session,
    name: string,
    total: number,
  ): RankingRow => ({ position, userId: who.userId, name, total });

  beforeAll(async () => {
    ({ app, dataSource } = await bootstrapApp());
  });

  afterEach(async () => {
    await sandbox.cleanup(dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('CP-115-01 la ficha incluye el top del mes ordenado por monto, con posición, nombre y total', async () => {
    const a = await org('A');
    const ana = await donor('Ana');
    const bruno = await donor('Bruno');
    const carla = await donor('Carla');
    await give(a.id, ana, 3000);
    await give(a.id, bruno, 5000);
    await give(a.id, carla, 1000);

    const res = await publicOrg(app, a.id);
    expect(res.status).toBe(200);
    expect(res.body.topDonors).toEqual([
      row(1, bruno, 'Bruno', 5000),
      row(2, ana, 'Ana', 3000),
      row(3, carla, 'Carla', 1000),
    ]);
    // Sin email ni teléfono: las donaciones se sembraron con el email de la
    // cuenta como contacto; si se filtra, aparece en el top.
    expect(JSON.stringify(res.body.topDonors)).not.toContain('@');
    // El resto de la ficha viene completo.
    expect(res.body).toMatchObject({
      id: a.id,
      name: a.name,
      donations: { acceptsMonetary: true },
    });
    for (const key of ['needs', 'collectionPoints', 'posts', 'stories']) {
      expect(Array.isArray(res.body[key])).toBe(true);
    }
  });

  it('CP-115-02 cada ficha cuenta solo lo donado a esa organización, no el total del donante', async () => {
    const a = await org('A');
    const b = await org('B');
    const ana = await donor('Ana');
    await give(a.id, ana, 2000);
    await give(b.id, ana, 6000);

    const fichaA = await publicOrg(app, a.id).expect(200);
    const fichaB = await publicOrg(app, b.id).expect(200);
    expect(fichaA.body.topDonors).toEqual([row(1, ana, 'Ana', 2000)]);
    expect(fichaB.body.topDonors).toEqual([row(1, ana, 'Ana', 6000)]);
  });

  it('CP-115-03 con más de cinco donantes la ficha muestra solo los cinco de mayor monto', async () => {
    const a = await org('A');
    for (let n = 1; n <= 7; n++) {
      await give(a.id, await donor(`Donante ${n}`), 1000 * n);
    }

    const res = await publicOrg(app, a.id).expect(200);
    const top = res.body.topDonors as RankingRow[];
    expect(top).toHaveLength(5);
    expect(top.map((r) => r.total)).toEqual([7000, 6000, 5000, 4000, 3000]);
    expect(top.map((r) => r.position)).toEqual([1, 2, 3, 4, 5]);
  });

  it('CP-115-04 las anónimas y las declaradas sin confirmar no aparecen ni alteran el ranking', async () => {
    const a = await org('A');
    const ana = await donor('Ana');
    const bruno = await donor('Bruno');
    const carla = await donor('Carla');
    await give(a.id, ana, 9000, { isAnonymous: true });
    await give(a.id, bruno, 8000, { status: 'declarada' });
    await give(a.id, carla, 2000);

    const res = await publicOrg(app, a.id).expect(200);
    expect(res.body.topDonors).toEqual([row(1, carla, 'Carla', 2000)]);
  });

  it('CP-115-05 sin donaciones que cuenten en el mes: top vacío y el resto de la ficha normal', async () => {
    const a = await org('A');
    const supply = await request(app.getHttpServer())
      .post('/supplies')
      .set('Authorization', `Bearer ${a.ownerToken}`)
      .send({
        name: 'Leche en polvo',
        category: SupplyCategory.ALIMENTOS_SECOS,
        unit: SupplyUnit.KILOGRAMOS,
      })
      .expect(201);
    const need = await request(app.getHttpServer())
      .post('/needs')
      .set('Authorization', `Bearer ${a.ownerToken}`)
      .send({
        supplyId: supply.body.id,
        requiredQuantity: 10,
        deadline: addDays(today(), 10),
      })
      .expect(201);
    const [point]: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO collection_points
         ("organizationId", name, "addressLine", latitude, longitude, phone, schedule, active)
       VALUES ($1, 'Sede central', 'Bv. Sarmiento 1450', -32.41, -63.24, '353 412-7788', '[]'::jsonb, true)
       RETURNING id`,
      [a.id],
    );
    const ana = await donor('Ana');
    await give(a.id, ana, 5000, { createdAt: lastMonth() });

    const res = await publicOrg(app, a.id);
    expect(res.status).toBe(200);
    expect(res.body.topDonors).toEqual([]);
    expect((res.body.needs as Array<{ id: string }>).map((n) => n.id)).toEqual([
      need.body.id,
    ]);
    expect(
      (res.body.collectionPoints as Array<{ id: string }>).map((p) => p.id),
    ).toEqual([point.id]);
    expect(res.body.donations.acceptsMonetary).toBe(true);
  });

  it('CP-115-06 organización sin datos de cobro no muestra el top ni el bloque de donar dinero', async () => {
    const a = await org('A');
    const ana = await donor('Ana');
    await give(a.id, ana, 3000);
    await dataSource.query(
      `UPDATE organizations SET "paymentAlias" = NULL WHERE id = $1`,
      [a.id],
    );

    const res = await publicOrg(app, a.id);
    expect(res.status).toBe(200);
    expect(res.body.donations.acceptsMonetary).toBe(false);
    expect(res.body.topDonors).toEqual([]);
  });

  it('CP-115-07 aislamiento entre fichas y coherencia con el ranking global', async () => {
    const a = await org('A');
    const b = await org('B');
    const ana = await donor('Ana');
    const bruno = await donor('Bruno');
    await give(a.id, ana, 3000);
    await give(b.id, ana, 1000);
    await give(b.id, bruno, 2000);

    const fichaA = await publicOrg(app, a.id).expect(200);
    const fichaB = await publicOrg(app, b.id).expect(200);
    const global = await topDonors(app).expect(200);

    expect(fichaA.body.topDonors).toEqual([row(1, ana, 'Ana', 3000)]);
    expect(fichaB.body.topDonors).toEqual([
      row(1, bruno, 'Bruno', 2000),
      row(2, ana, 'Ana', 1000),
    ]);
    const anaGlobal = (global.body as RankingRow[]).find(
      (r) => r.userId === ana.userId,
    );
    expect(anaGlobal?.total).toBe(4000);
    expect(anaGlobal?.total).toBe(
      (fichaA.body.topDonors as RankingRow[])[0].total +
        (fichaB.body.topDonors as RankingRow[])[1].total,
    );
  });
});
