/**
 * QK-26 · Gestionar Donación Presencial — CP-26-01 a CP-26-07
 *
 * El contrato del PDF del Sprint 2 (donante con cuenta que carga una donación
 * "pendiente de entrega", la consulta en `/donations/mine` y espera que el
 * comedor la confirme con `PATCH /donations/:id/confirm`) quedó **descartado en
 * el refinamiento de la historia**. El flujo real es el inverso:
 *
 *   la organización registra la donación en el momento de recibirla.
 *
 * De ahí las tres diferencias con el PDF, que estos casos reflejan:
 *   - no hay cuenta de donante: el POST lo hace un miembro con rol de escritura;
 *   - no hay máquina de estados: la donación nace recibida;
 *   - el punto de recolección es **opcional** (la entrega puede haber llegado a
 *     la sede), así que CP-26-02 se invierte: sin punto ahora es 201, no 400.
 *
 * Se conservan los identificadores CP-26-0x para no perder la trazabilidad del
 * entregable.
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
} from './helpers';

interface Need {
  id: string;
  supplyId: string;
  requiredQuantity: number;
  coveredQuantity: number;
}

describe('QK-26 Gestionar Donación Presencial (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let orgToken: string;
  let volunteerToken: string;
  let orgId: string;
  let collectionPointId: string;
  let supplyId: string;
  let otherSupplyId: string;
  let needId: string;
  const orgIds: string[] = [];
  const emails: string[] = [];

  beforeAll(async () => {
    ({ app, dataSource } = await bootstrapApp());

    const ownerEmail = uniqueEmail('qk26-owner');
    emails.push(ownerEmail);
    const ownerSession = await registerAndLogin(app, ownerEmail);
    const org = await createOrganization(app, ownerSession.token);
    orgId = org.id;
    orgIds.push(orgId);
    orgToken = await switchOrg(app, ownerSession.token, orgId);

    // Punto de recolección real (QK-12).
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

    // Catálogo (QK-14) y necesidad abierta (QK-21): precondiciones del flujo.
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

    // Voluntario: no puede registrar donaciones (CP-26-07).
    const volunteerEmail = uniqueEmail('qk26-volunteer');
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

  it('CP-26-01: la organización registra una donación recibida', async () => {
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

    const body = res.body as {
      id: string;
      collectionPointId: string;
      items: { quantity: number }[];
    };
    expect(body.id).toBeDefined();
    expect(body.collectionPointId).toBe(collectionPointId);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].quantity).toBe(10);
  });

  it('CP-26-02: el punto de recolección es opcional (la entrega pudo llegar a la sede)', async () => {
    await request(app.getHttpServer())
      .post('/donations')
      .set('Authorization', `Bearer ${orgToken}`)
      .send({ items: [{ supplyId, quantity: 5 }] })
      .expect(201);
  });

  it('CP-26-03: la donación aparece en el historial de la organización', async () => {
    const res = await request(app.getHttpServer())
      .get('/donations')
      .set('Authorization', `Bearer ${orgToken}`)
      .expect(200);

    const donations = res.body as { items: unknown[] }[];
    expect(donations.length).toBeGreaterThan(0);
    expect(donations[0].items.length).toBeGreaterThan(0);
  });

  it('CP-26-04: la donación acredita la necesidad asociada, sin pasarse del total', async () => {
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

  it('CP-26-05: rechaza un ítem cuyo insumo no es el de la necesidad', async () => {
    await request(app.getHttpServer())
      .post('/donations')
      .set('Authorization', `Bearer ${orgToken}`)
      .send({ items: [{ supplyId: otherSupplyId, needId, quantity: 3 }] })
      .expect(400);
  });

  it('CP-26-06: valida cantidades inválidas (cero o negativas) y donaciones vacías', async () => {
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

  it('CP-26-07: un voluntario no puede registrar donaciones', async () => {
    await request(app.getHttpServer())
      .post('/donations')
      .set('Authorization', `Bearer ${volunteerToken}`)
      .send({ items: [{ supplyId, quantity: 1 }] })
      .expect(403);
  });
});
