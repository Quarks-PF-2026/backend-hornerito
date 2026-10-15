/**
 * QK-26 · Gestionar Donación Presencial — trazabilidad CP-26-01 a CP-26-10
 *
 * Suite NUEVA de trazabilidad QA (IDs del plan de pruebas del Sprint 3), aparte
 * de `test/sprint2/qk-26-donation.e2e-spec.ts` (regresión real del equipo,
 * nombrada por criterio de aceptación). No se toca ese archivo; acá se repiten
 * los mismos escenarios con el ID `CP-26-NN` explícito, más los tres que en la
 * suite original solo estaban cubiertos "de hecho" (voluntario 403, aislamiento
 * entre organizaciones y donante anónimo).
 *
 * Contrato real verificado en `donation.controller.ts` / `donation.service.ts`
 * (no el genérico del PDF, ver header de `qk-26-donation.e2e-spec.ts`):
 *   - `POST /donations` (CONTENT_WRITER_ROLES) y `GET /donations` (cualquier
 *     miembro activo, incluido voluntario);
 *   - la organización registra la donación en el momento de recibirla: nace
 *     recibida, sin máquina de estados, y el punto de recolección es opcional.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  DEFAULT_PASSWORD,
  bootstrapApp,
  cleanupOrganizations,
  cleanupUsers,
  createOrganization,
  registerAndLogin,
  switchOrg,
  uniqueEmail,
} from './sprint2/helpers';

interface Need {
  id: string;
  supplyId: string;
  requiredQuantity: number;
  coveredQuantity: number;
}

interface DonationBody {
  id: string;
  collectionPointId: string | null;
  donorName: string | null;
  donorContact: string | null;
  items: { id: string; supplyId: string; needId: string | null; quantity: number }[];
}

describe('QK-26 · Gestionar Donación Presencial — trazabilidad CP-26 (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let orgToken: string;
  let volunteerToken: string;
  let orgId: string;
  let collectionPointId: string;
  let supplyId: string;
  let otherSupplyId: string;
  let needId: string;

  /** Segunda organización, exclusiva de CP-26-09 (aislamiento entre tenants). */
  let otherOrgToken: string;
  let otherOrgSupplyId: string;

  const orgIds: string[] = [];
  const emails: string[] = [];

  beforeAll(async () => {
    ({ app, dataSource } = await bootstrapApp());

    const ownerEmail = uniqueEmail('qk26cp-owner');
    emails.push(ownerEmail);
    const ownerSession = await registerAndLogin(app, ownerEmail);
    const org = await createOrganization(app, ownerSession.token);
    orgId = org.id;
    orgIds.push(orgId);
    orgToken = await switchOrg(app, ownerSession.token, orgId);

    const point = await request(app.getHttpServer())
      .post('/collection-points')
      .set('Authorization', `Bearer ${orgToken}`)
      .send({
        name: 'Sede Central',
        addressLine: 'Bv. Sarmiento 1450',
        latitude: -32.4083,
        longitude: -63.2402,
        phone: '353 412-7788',
        schedule: Array.from({ length: 7 }, (_, day) => ({
          day,
          closed: false,
          open: '09:00',
          close: '17:00',
        })),
      })
      .expect(201);
    collectionPointId = (point.body as { id: string }).id;

    const supply = await request(app.getHttpServer())
      .post('/supplies')
      .set('Authorization', `Bearer ${orgToken}`)
      .send({ name: 'Arroz', category: 'Alimentos secos', unit: 'Kilogramos' })
      .expect(201);
    supplyId = (supply.body as { id: string }).id;

    const otherSupply = await request(app.getHttpServer())
      .post('/supplies')
      .set('Authorization', `Bearer ${orgToken}`)
      .send({ name: 'Lavandina', category: 'Limpieza', unit: 'Litros' })
      .expect(201);
    otherSupplyId = (otherSupply.body as { id: string }).id;

    const need = await request(app.getHttpServer())
      .post('/needs')
      .set('Authorization', `Bearer ${orgToken}`)
      .send({ supplyId, requiredQuantity: 50, deadline: '2026-12-31' })
      .expect(201);
    needId = (need.body as { id: string }).id;

    // Voluntario de la misma organización: CP-26-08.
    const volunteerEmail = uniqueEmail('qk26cp-volunteer');
    emails.push(volunteerEmail);
    await request(app.getHttpServer())
      .post('/organization/members/invitations')
      .set('Authorization', `Bearer ${orgToken}`)
      .send({ email: volunteerEmail, role: 'voluntario' })
      .expect(201);
    const rows: Array<{ token: string }> = await dataSource.query(
      `SELECT token FROM organization_invitations
       WHERE email = $1 AND "organizationId" = $2
       ORDER BY "createdAt" DESC LIMIT 1`,
      [volunteerEmail, orgId],
    );
    const accepted = await request(app.getHttpServer())
      .post(`/invitations/${rows[0].token}/accept`)
      .send({ name: 'Voluntario de prueba', password: DEFAULT_PASSWORD })
      .expect(201);
    volunteerToken = (accepted.body as { accessToken: string }).accessToken;

    // Segunda organización: CP-26-09.
    const otherOwnerEmail = uniqueEmail('qk26cp-otherowner');
    emails.push(otherOwnerEmail);
    const otherOwnerSession = await registerAndLogin(app, otherOwnerEmail);
    const otherOrg = await createOrganization(app, otherOwnerSession.token, {
      name: 'Comedor de otra ciudad',
    });
    orgIds.push(otherOrg.id);
    otherOrgToken = await switchOrg(app, otherOwnerSession.token, otherOrg.id);
    const otherOrgSupply = await request(app.getHttpServer())
      .post('/supplies')
      .set('Authorization', `Bearer ${otherOrgToken}`)
      .send({ name: 'Fideos', category: 'Alimentos secos', unit: 'Kilogramos' })
      .expect(201);
    otherOrgSupplyId = (otherOrgSupply.body as { id: string }).id;
  });

  afterAll(async () => {
    await cleanupOrganizations(dataSource, orgIds);
    await cleanupUsers(dataSource, emails);
    await app.close();
  });

  async function findNeed(id: string): Promise<Need> {
    const res = await request(app.getHttpServer())
      .get('/needs')
      .set('Authorization', `Bearer ${orgToken}`)
      .expect(200);
    const needs = res.body as Need[];
    return needs.find((n) => n.id === id)!;
  }

  it('CP-26-01: registra una donación con insumos válidos y la lista en el historial', async () => {
    const res = await request(app.getHttpServer())
      .post('/donations')
      .set('Authorization', `Bearer ${orgToken}`)
      .send({
        collectionPointId,
        donorName: 'Ana Pérez',
        donorContact: '353 555-0000',
        items: [{ supplyId, needId, quantity: 10 }],
      })
      .expect(201);

    const body = res.body as DonationBody;
    expect(body.id).toBeDefined();
    expect(body.collectionPointId).toBe(collectionPointId);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].quantity).toBe(10);

    const list = await request(app.getHttpServer())
      .get('/donations')
      .set('Authorization', `Bearer ${orgToken}`)
      .expect(200);
    expect((list.body as DonationBody[]).some((d) => d.id === body.id)).toBe(
      true,
    );
  });

  it('CP-26-02: el punto de recolección es opcional (la entrega pudo llegar a la sede)', async () => {
    const res = await request(app.getHttpServer())
      .post('/donations')
      .set('Authorization', `Bearer ${orgToken}`)
      .send({ items: [{ supplyId, quantity: 5 }] })
      .expect(201);
    expect((res.body as DonationBody).collectionPointId).toBeNull();
  });

  it('CP-26-03: rechaza un punto de recolección que no existe (o de otra organización)', async () => {
    await request(app.getHttpServer())
      .post('/donations')
      .set('Authorization', `Bearer ${orgToken}`)
      .send({
        collectionPointId: '00000000-0000-0000-0000-000000000000',
        items: [{ supplyId, quantity: 1 }],
      })
      .expect(404);
  });

  it('CP-26-04: acredita la necesidad asociada al insumo, sin pasarse del total requerido', async () => {
    const before = await findNeed(needId);

    await request(app.getHttpServer())
      .post('/donations')
      .set('Authorization', `Bearer ${orgToken}`)
      .send({ items: [{ supplyId, needId, quantity: 7 }] })
      .expect(201);

    const after = await findNeed(needId);
    expect(after.coveredQuantity).toBe(before.coveredQuantity + 7);
    expect(after.coveredQuantity).toBeLessThanOrEqual(after.requiredQuantity);
  });

  it('CP-26-05: rechaza un ítem cuyo insumo no coincide con el de la necesidad', async () => {
    await request(app.getHttpServer())
      .post('/donations')
      .set('Authorization', `Bearer ${orgToken}`)
      .send({ items: [{ supplyId: otherSupplyId, needId, quantity: 3 }] })
      .expect(400);
  });

  it('CP-26-06: rechaza cantidades inválidas (cero, negativas) y una donación sin ítems', async () => {
    await request(app.getHttpServer())
      .post('/donations')
      .set('Authorization', `Bearer ${orgToken}`)
      .send({ items: [{ supplyId, quantity: 0 }] })
      .expect(400);

    await request(app.getHttpServer())
      .post('/donations')
      .set('Authorization', `Bearer ${orgToken}`)
      .send({ items: [{ supplyId, quantity: -5 }] })
      .expect(400);

    await request(app.getHttpServer())
      .post('/donations')
      .set('Authorization', `Bearer ${orgToken}`)
      .send({ items: [] })
      .expect(400);
  });

  it('CP-26-07: sin autenticación no se puede registrar ni consultar donaciones', async () => {
    await request(app.getHttpServer())
      .post('/donations')
      .send({ items: [{ supplyId, quantity: 1 }] })
      .expect(401);

    await request(app.getHttpServer()).get('/donations').expect(401);
  });

  it('CP-26-08: un voluntario no puede registrar donaciones, pero sí ver el historial', async () => {
    await request(app.getHttpServer())
      .post('/donations')
      .set('Authorization', `Bearer ${volunteerToken}`)
      .send({ items: [{ supplyId, quantity: 1 }] })
      .expect(403);

    await request(app.getHttpServer())
      .get('/donations')
      .set('Authorization', `Bearer ${volunteerToken}`)
      .expect(200);
  });

  it('CP-26-09: el historial no cruza organizaciones (aislamiento multi-tenant)', async () => {
    const own = await request(app.getHttpServer())
      .post('/donations')
      .set('Authorization', `Bearer ${orgToken}`)
      .send({ items: [{ supplyId, quantity: 2 }] })
      .expect(201);
    const ownId = (own.body as DonationBody).id;

    const otherDonation = await request(app.getHttpServer())
      .post('/donations')
      .set('Authorization', `Bearer ${otherOrgToken}`)
      .send({ items: [{ supplyId: otherOrgSupplyId, quantity: 1 }] })
      .expect(201);
    const otherId = (otherDonation.body as DonationBody).id;

    const listOwn = await request(app.getHttpServer())
      .get('/donations')
      .set('Authorization', `Bearer ${orgToken}`)
      .expect(200);
    const ownIds = (listOwn.body as DonationBody[]).map((d) => d.id);
    expect(ownIds).toContain(ownId);
    expect(ownIds).not.toContain(otherId);

    const listOther = await request(app.getHttpServer())
      .get('/donations')
      .set('Authorization', `Bearer ${otherOrgToken}`)
      .expect(200);
    const otherIds = (listOther.body as DonationBody[]).map((d) => d.id);
    expect(otherIds).toContain(otherId);
    expect(otherIds).not.toContain(ownId);
  });

  it('CP-26-10: acepta un donante totalmente anónimo (sin donorName ni donorContact)', async () => {
    const res = await request(app.getHttpServer())
      .post('/donations')
      .set('Authorization', `Bearer ${orgToken}`)
      .send({ items: [{ supplyId, quantity: 3 }] })
      .expect(201);

    const body = res.body as DonationBody;
    expect(body.donorName).toBeNull();
    expect(body.donorContact).toBeNull();
  });
});
