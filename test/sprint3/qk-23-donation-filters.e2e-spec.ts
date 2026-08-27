/**
 * QK-23 · Gestionar Donaciones — CP-23-01 a CP-23-05
 *
 * El historial se filtra en el backend. Lo que se prueba acá es lo que el
 * front no puede: que el rango se traduzca bien a instantes sobre una columna
 * `timestamptz`, con el "hasta" inclusivo y sin corrimiento de día por la
 * diferencia entre la hora local de la organización y UTC.
 *
 * Las donaciones se crean por la API y después se les mueve `createdAt` con
 * SQL: es la única forma de tener un historial repartido en el tiempo sin
 * esperar días entre casos.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  bootstrapApp,
  cleanupOrganizations,
  cleanupUsers,
  createOrganization,
  registerAndLogin,
  switchOrg,
  uniqueEmail,
} from '../sprint2/helpers';

interface DonationRow {
  id: string;
}

describe('QK-23 · Historial de donaciones filtrado por el backend (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let orgToken: string;
  let orgId: string;
  let supplyId: string;

  const emails: string[] = [];
  const orgIds: string[] = [];

  /** Ids de las presenciales, en el orden en que se las fecha. */
  const inPerson: Record<string, string> = {};

  function listInPerson(query: Record<string, string> = {}) {
    return request(app.getHttpServer())
      .get('/donations')
      .query(query)
      .set('Authorization', `Bearer ${orgToken}`);
  }

  function listMonetary(query: Record<string, string> = {}) {
    return request(app.getHttpServer())
      .get('/donations/monetary')
      .query(query)
      .set('Authorization', `Bearer ${orgToken}`);
  }

  /** Mueve una donación a un instante concreto, en UTC. */
  async function backdate(id: string, instantUtc: string): Promise<void> {
    await dataSource.query(`UPDATE donations SET "createdAt" = $1 WHERE id = $2`, [
      instantUtc,
      id,
    ]);
  }

  async function createInPerson(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/donations')
      .set('Authorization', `Bearer ${orgToken}`)
      .send({ items: [{ supplyId, quantity: 1 }] })
      .expect(201);
    return (res.body as DonationRow).id;
  }

  beforeAll(async () => {
    ({ app, dataSource } = await bootstrapApp());

    const ownerEmail = uniqueEmail('qk23-owner');
    emails.push(ownerEmail);
    const owner = await registerAndLogin(app, ownerEmail);
    const org = await createOrganization(app, owner.token);
    orgId = org.id;
    orgIds.push(orgId);
    orgToken = await switchOrg(app, owner.token, orgId);

    const supply = await request(app.getHttpServer())
      .post('/supplies')
      .set('Authorization', `Bearer ${orgToken}`)
      .send({ name: 'Arroz', category: 'Alimentos secos', unit: 'Kilogramos' })
      .expect(201);
    supplyId = (supply.body as { id: string }).id;

    // Tres presenciales repartidas: una antes del rango, una adentro y una
    // sobre el borde de la noche del último día.
    inPerson.vieja = await createInPerson();
    inPerson.dentro = await createInPerson();
    inPerson.borde = await createInPerson();

    await backdate(inPerson.vieja, '2026-07-15T15:00:00.000Z');
    await backdate(inPerson.dentro, '2026-08-10T15:00:00.000Z');
    // 22:30 del 31 de agosto en Argentina son las 01:30Z del 1 de septiembre.
    await backdate(inPerson.borde, '2026-09-01T01:30:00.000Z');

    // Dos económicas declaradas desde la ficha pública.
    await request(app.getHttpServer())
      .put('/organization/me')
      .set('Authorization', `Bearer ${orgToken}`)
      .send({
        name: 'Comedor Manos del Barrio',
        description: 'Brindamos almuerzo y merienda a más de 80 chicos.',
        address: 'Bv. Sarmiento 1450, Villa María, Córdoba',
        contact: '353 412-7788',
        paymentAlias: 'manos.del.barrio',
        paymentHolder: 'Asociación Manos del Barrio',
        paymentCuit: '30-71234567-8',
        paymentBank: 'Banco Nación',
      })
      .expect(200);

    for (const [amount, instant] of [
      [1500, '2026-07-20T15:00:00.000Z'],
      [2500, '2026-08-12T15:00:00.000Z'],
    ] as [number, string][]) {
      const declared = await request(app.getHttpServer())
        .post(`/public/organizations/${orgId}/donations`)
        .field({ amount: String(amount), method: 'transferencia' })
        .expect(201);
      await backdate((declared.body as DonationRow).id, instant);
    }
  });

  afterAll(async () => {
    await cleanupOrganizations(dataSource, orgIds);
    await cleanupUsers(dataSource, emails);
    await app.close();
  });

  it('CP-23-01 · sin filtros devuelve todo el historial presencial', async () => {
    const res = await listInPerson().expect(200);
    const ids = (res.body as DonationRow[]).map((d) => d.id);

    expect(ids).toHaveLength(3);
    // La más nueva primero.
    expect(ids[0]).toBe(inPerson.borde);
  });

  it('CP-23-02 · el rango deja afuera lo anterior al "desde"', async () => {
    const res = await listInPerson({ from: '2026-08-01' }).expect(200);
    const ids = (res.body as DonationRow[]).map((d) => d.id);

    expect(ids).not.toContain(inPerson.vieja);
    expect(ids).toContain(inPerson.dentro);
  });

  it('CP-23-03 · el "hasta" incluye el día entero, hora local', async () => {
    const res = await listInPerson({
      from: '2026-08-01',
      to: '2026-08-31',
    }).expect(200);
    const ids = (res.body as DonationRow[]).map((d) => d.id);

    // Recibida a las 22:30 del 31: cae dentro aunque en UTC sea 1 de septiembre.
    expect(ids).toContain(inPerson.borde);
    expect(ids).toContain(inPerson.dentro);
    expect(ids).not.toContain(inPerson.vieja);
  });

  it('CP-23-04 · las económicas combinan estado y rango', async () => {
    const todas = await listMonetary().expect(200);
    expect(todas.body as DonationRow[]).toHaveLength(2);

    const res = await listMonetary({
      status: 'declarada',
      from: '2026-08-01',
      to: '2026-08-31',
    }).expect(200);
    const amounts = (res.body as { amount: number }[]).map((d) => d.amount);

    expect(amounts).toEqual([2500]);
  });

  it('CP-23-05 · rechaza un rango dado vuelta o mal escrito', async () => {
    await listInPerson({ from: '2026-08-31', to: '2026-08-01' }).expect(400);
    await listMonetary({ from: '31-08-2026' }).expect(400);
    await listInPerson({ from: '2026-02-30' }).expect(400);
  });

  it('CP-23-06 · el filtro no cruza organizaciones', async () => {
    const otherEmail = uniqueEmail('qk23-other');
    emails.push(otherEmail);
    const other = await registerAndLogin(app, otherEmail);
    const otherOrg = await createOrganization(app, other.token, {
      name: 'Comedor Los Girasoles',
    });
    orgIds.push(otherOrg.id);
    const otherToken = await switchOrg(app, other.token, otherOrg.id);

    const res = await request(app.getHttpServer())
      .get('/donations')
      .query({ from: '2026-01-01', to: '2026-12-31' })
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);

    expect(res.body as DonationRow[]).toHaveLength(0);
  });
});
