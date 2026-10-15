/**
 * QK-23 · Gestionar Donaciones (historial e informes) — trazabilidad
 * CP-23-01 a CP-23-09
 *
 * Suite NUEVA de trazabilidad QA, aparte de
 * `test/sprint3/qk-23-donation-filters.e2e-spec.ts` (regresión real del
 * equipo). No se toca ese archivo.
 *
 * Contrato real verificado leyendo `donation.controller.ts`,
 * `monetary-donation.controller.ts` y el spec existente: **la respuesta de
 * `GET /donations` y `GET /donations/monetary` es un ARRAY PLANO**. No hay
 * wrapper `{ items, totals }` ni un campo de totales agregados en el
 * contrato actual — confirmado además con `grep -ri total
 * src/modules/donation/**` (sin resultados) y contra el frontend (sin
 * resultados tampoco). Por eso:
 *
 *   - CP-23-04 (totales por clase) queda como `it.todo`: no hay endpoint ni
 *     campo de agregados que probar. Es un **gap de alcance** frente al plan
 *     de QA, no un defecto ni un test fallido.
 *   - CP-23-05 se divide: la mitad ejecutable (un filtro que no matchea
 *     devuelve 200 + array vacío, sin error) se prueba normal; la mitad de
 *     "totales en cero" queda como `it.todo` con el mismo motivo que
 *     CP-23-04.
 *
 * El resto (separación por clase, rango inclusive con corrimiento de zona
 * horaria, filtro por estado en económicas, aislamiento, acceso de un
 * voluntario, 401 sin auth, 400 en rango inválido) es completamente
 * implementable — mismo patrón de backdate con SQL crudo que
 * `qk-23-donation-filters.e2e-spec.ts`.
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
} from './sprint2/helpers';

interface DonationRow {
  id: string;
}

describe('QK-23 · Gestionar Donaciones — trazabilidad CP-23 (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let orgToken: string;
  let orgId: string;
  let supplyId: string;
  let volunteerToken: string;

  const emails: string[] = [];
  const orgIds: string[] = [];

  const inPerson: Record<string, string> = {};
  const monetary: Record<string, string> = {};

  function listInPerson(query: Record<string, string> = {}, token = orgToken) {
    return request(app.getHttpServer())
      .get('/donations')
      .query(query)
      .set('Authorization', `Bearer ${token}`);
  }

  function listMonetary(query: Record<string, string> = {}, token = orgToken) {
    return request(app.getHttpServer())
      .get('/donations/monetary')
      .query(query)
      .set('Authorization', `Bearer ${token}`);
  }

  async function backdate(id: string, instantUtc: string): Promise<void> {
    await dataSource.query(
      `UPDATE donations SET "createdAt" = $1 WHERE id = $2`,
      [instantUtc, id],
    );
  }

  async function createInPerson(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/donations')
      .set('Authorization', `Bearer ${orgToken}`)
      .send({ items: [{ supplyId, quantity: 1 }] })
      .expect(201);
    return (res.body as DonationRow).id;
  }

  async function declareMonetary(amount: number): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/public/organizations/${orgId}/donations`)
      .field({ amount: String(amount), method: 'transferencia' })
      .expect(201);
    return (res.body as DonationRow).id;
  }

  beforeAll(async () => {
    ({ app, dataSource } = await bootstrapApp());

    const ownerEmail = uniqueEmail('qk23cp-owner');
    emails.push(ownerEmail);
    const owner = await registerAndLogin(app, ownerEmail);
    const org = await createOrganization(app, owner.token);
    orgId = org.id;
    orgIds.push(orgId);
    orgToken = await switchOrg(app, owner.token, orgId);

    const volunteerEmail = uniqueEmail('qk23cp-volunteer');
    emails.push(volunteerEmail);
    const volunteer = await registerAndLogin(app, volunteerEmail);
    await dataSource.query(
      `INSERT INTO organization_memberships ("userId", "organizationId", role, active)
       VALUES ($1, $2, 'voluntario', true)`,
      [volunteer.userId, orgId],
    );
    volunteerToken = await switchOrg(app, volunteer.token, orgId);

    const supply = await request(app.getHttpServer())
      .post('/supplies')
      .set('Authorization', `Bearer ${orgToken}`)
      .send({ name: 'Arroz', category: 'Alimentos secos', unit: 'Kilogramos' })
      .expect(201);
    supplyId = (supply.body as { id: string }).id;

    // Tres presenciales repartidas en el tiempo: antes del rango, adentro y
    // sobre el borde de la noche del último día (zona horaria local).
    inPerson.vieja = await createInPerson();
    inPerson.dentro = await createInPerson();
    inPerson.borde = await createInPerson();
    await backdate(inPerson.vieja, '2026-07-15T15:00:00.000Z');
    await backdate(inPerson.dentro, '2026-08-10T15:00:00.000Z');
    // 22:30 del 31 de agosto en Argentina son las 01:30Z del 1 de septiembre.
    await backdate(inPerson.borde, '2026-09-01T01:30:00.000Z');

    // Datos bancarios: precondición para declarar económicas.
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

    monetary.dentro = await declareMonetary(1500);
    monetary.fueraDeRango = await declareMonetary(2500);
    await backdate(monetary.dentro, '2026-08-12T15:00:00.000Z');
    await backdate(monetary.fueraDeRango, '2026-07-01T15:00:00.000Z');

    // Confirmar una para poder filtrar por estado (CP-23-03).
    await request(app.getHttpServer())
      .post(`/donations/monetary/${monetary.dentro}/confirm`)
      .set('Authorization', `Bearer ${orgToken}`)
      .expect(201);
  });

  afterAll(async () => {
    await cleanupOrganizations(dataSource, orgIds);
    await cleanupUsers(dataSource, emails);
    await app.close();
  });

  it('CP-23-01: el historial separa donaciones presenciales de económicas (misma tabla, listados distintos)', async () => {
    const presenciales = await listInPerson().expect(200);
    const economicas = await listMonetary().expect(200);

    const presencialIds = (presenciales.body as DonationRow[]).map((d) => d.id);
    const economicaIds = (economicas.body as DonationRow[]).map((d) => d.id);

    expect(presencialIds).toEqual(
      expect.arrayContaining([
        inPerson.vieja,
        inPerson.dentro,
        inPerson.borde,
      ]),
    );
    expect(economicaIds).toEqual(
      expect.arrayContaining([monetary.dentro, monetary.fueraDeRango]),
    );
    // Ningún id se cuela en el listado del otro tipo.
    expect(presencialIds).not.toEqual(
      expect.arrayContaining([monetary.dentro]),
    );
    expect(economicaIds).not.toEqual(
      expect.arrayContaining([inPerson.dentro]),
    );
  });

  it('CP-23-02: sin filtros devuelve todo el historial, más nuevo primero', async () => {
    const res = await listInPerson().expect(200);
    const ids = (res.body as DonationRow[]).map((d) => d.id);
    expect(ids[0]).toBe(inPerson.borde);
  });

  it('CP-23-03: el rango de fechas es inclusive en ambos extremos, en hora local de la organización', async () => {
    const desde = await listInPerson({ from: '2026-08-01' }).expect(200);
    const desdeIds = (desde.body as DonationRow[]).map((d) => d.id);
    expect(desdeIds).not.toContain(inPerson.vieja);
    expect(desdeIds).toContain(inPerson.dentro);

    const rango = await listInPerson({
      from: '2026-08-01',
      to: '2026-08-31',
    }).expect(200);
    const rangoIds = (rango.body as DonationRow[]).map((d) => d.id);
    // Recibida a las 22:30 del 31: cae dentro aunque en UTC ya sea 1/9.
    expect(rangoIds).toContain(inPerson.borde);
    expect(rangoIds).toContain(inPerson.dentro);
    expect(rangoIds).not.toContain(inPerson.vieja);
  });

  // No implementado: el backend no expone un endpoint/campo de totales
  // agregados por clase; los arrays se devuelven planos. No es un defecto —
  // es un gap de alcance frente al plan de QA, repórtalo como tal (no como
  // test fallido).
  it.todo('CP-23-04: totales agregados por clase de donación');

  it('CP-23-05a: un filtro que no matchea nada responde 200 con un array vacío, sin error', async () => {
    const res = await listInPerson({
      from: '2020-01-01',
      to: '2020-01-31',
    }).expect(200);
    expect(res.body as DonationRow[]).toEqual([]);
  });

  // No implementado, mismo motivo que CP-23-04: no hay campo de totales que
  // probar cuando el filtro no matchea nada.
  it.todo('CP-23-05b: "totales en cero" cuando el filtro no matchea nada');

  it('CP-23-06: las donaciones económicas se pueden filtrar combinando estado y rango de fechas', async () => {
    const todas = await listMonetary().expect(200);
    expect((todas.body as DonationRow[]).length).toBeGreaterThanOrEqual(2);

    const res = await listMonetary({
      status: 'confirmada',
      from: '2026-08-01',
      to: '2026-08-31',
    }).expect(200);
    const ids = (res.body as DonationRow[]).map((d) => d.id);
    expect(ids).toEqual([monetary.dentro]);
  });

  it('CP-23-07: un rango dado vuelta o mal escrito se rechaza con 400', async () => {
    await listInPerson({ from: '2026-08-31', to: '2026-08-01' }).expect(400);
    await listMonetary({ from: '31-08-2026' }).expect(400);
    await listInPerson({ from: '2026-02-30' }).expect(400);
  });

  it('CP-23-08: el historial no cruza organizaciones (aislamiento multi-tenant)', async () => {
    const otherEmail = uniqueEmail('qk23cp-other');
    emails.push(otherEmail);
    const other = await registerAndLogin(app, otherEmail);
    const otherOrg = await createOrganization(app, other.token, {
      name: 'Comedor Los Girasoles',
    });
    orgIds.push(otherOrg.id);
    const otherToken = await switchOrg(app, other.token, otherOrg.id);

    const inPersonRes = await listInPerson(
      { from: '2026-01-01', to: '2026-12-31' },
      otherToken,
    ).expect(200);
    expect(inPersonRes.body as DonationRow[]).toHaveLength(0);

    const monetaryRes = await listMonetary(
      { from: '2026-01-01', to: '2026-12-31' },
      otherToken,
    ).expect(200);
    expect(monetaryRes.body as DonationRow[]).toHaveLength(0);
  });

  it('CP-23-09: un voluntario puede consultar el historial (solo lectura), y sin autenticación se rechaza con 401', async () => {
    await listInPerson({}, volunteerToken).expect(200);
    await listMonetary({}, volunteerToken).expect(200);

    await request(app.getHttpServer()).get('/donations').expect(401);
    await request(app.getHttpServer()).get('/donations/monetary').expect(401);
  });
});
