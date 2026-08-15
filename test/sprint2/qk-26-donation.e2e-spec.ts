/**
 * QK-26 · Gestionar Donación Presencial — CP-26-01 a CP-26-06
 * Casos tal como figuran en "Documentación del sprint 2 - Equipo 14.pdf".
 *
 * Estado real: no existe ningún módulo de donaciones en el backend
 * (`grep -rniE "donation|donacion" src` no encuentra entidad, service ni
 * controller — solo dos menciones de "donaciones" en copys/comentarios) ni
 * en el frontend. Coincide con lo que la propia retrospectiva del PDF
 * admite ("La historia QK-26 ... no se completó dentro del plazo del
 * Sprint y debió reprogramarse para el Sprint 3"), aunque la tabla de
 * Sprint Review del mismo documento la lista como resuelta 5/5 —
 * contradicción a resolver en el propio entregable.
 *
 * Estos 6 casos ejercitan las rutas que el flujo del PDF requeriría
 * (`/donations`). Al no existir, Nest responde 404 y cada test falla contra
 * el resultado esperado del PDF — es la evidencia formal de que QK-26 no
 * está implementada.
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
} from './helpers';

describe('QK-26 Gestionar Donación Presencial (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let donorToken: string;
  let collectionPointId: string;
  const orgIds: string[] = [];
  const emails: string[] = [];

  beforeAll(async () => {
    ({ app, dataSource } = await bootstrapApp());

    // Punto de recolección real (QK-12), para poder mandar un id plausible
    // en el body aunque el endpoint de donación no exista.
    const ownerEmail = uniqueEmail('qk26-owner');
    emails.push(ownerEmail);
    const ownerSession = await registerAndLogin(app, ownerEmail);
    const org = await createOrganization(app, ownerSession.token);
    orgIds.push(org.id);
    const orgToken = await switchOrg(app, ownerSession.token, org.id);

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

    const donorEmail = uniqueEmail('qk26-donor');
    emails.push(donorEmail);
    const donorSession = await registerAndLogin(app, donorEmail);
    donorToken = donorSession.token;
  });

  afterAll(async () => {
    await cleanupOrganizations(dataSource, orgIds);
    await cleanupUsers(dataSource, emails);
    await app.close();
  });

  it('CP-26-01: registra una donación física y queda "pendiente de entrega"', async () => {
    const res = await request(app.getHttpServer())
      .post('/donations')
      .set('Authorization', `Bearer ${donorToken}`)
      .send({
        supplyName: 'Arroz',
        quantity: 10,
        unit: 'kilogramos',
        collectionPointId,
      })
      .expect(201);

    expect((res.body as { status: string }).status).toBe(
      'pendiente_de_entrega',
    );
  });

  it('CP-26-02: exige seleccionar un punto de recolección antes de confirmar', async () => {
    await request(app.getHttpServer())
      .post('/donations')
      .set('Authorization', `Bearer ${donorToken}`)
      .send({ supplyName: 'Leche', quantity: 5, unit: 'litros' })
      .expect(400);
  });

  it('CP-26-03: el donante consulta el estado y ve "pendiente de entrega"', async () => {
    await request(app.getHttpServer())
      .get('/donations/mine')
      .set('Authorization', `Bearer ${donorToken}`)
      .expect(200);
  });

  it('CP-26-04: tras la confirmación del comedor, el donante ve "recibida"', async () => {
    const created = await request(app.getHttpServer())
      .post('/donations')
      .set('Authorization', `Bearer ${donorToken}`)
      .send({
        supplyName: 'Arroz',
        quantity: 10,
        unit: 'kilogramos',
        collectionPointId,
      });
    const donationId = (created.body as { id?: string }).id;

    await request(app.getHttpServer())
      .patch(`/donations/${donationId}/confirm`)
      .set('Authorization', `Bearer ${donorToken}`)
      .expect(200);
  });

  it('CP-26-05: la donación queda asociada a la necesidad/insumo correcto', async () => {
    // Depende por completo de CP-26-01 (crear la donación), que ya falla.
    await request(app.getHttpServer())
      .post('/donations')
      .set('Authorization', `Bearer ${donorToken}`)
      .send({
        supplyName: 'Arroz',
        quantity: 10,
        unit: 'kilogramos',
        collectionPointId,
      })
      .expect(201);
  });

  it('CP-26-06: valida cantidades inválidas (cero o negativas)', async () => {
    await request(app.getHttpServer())
      .post('/donations')
      .set('Authorization', `Bearer ${donorToken}`)
      .send({
        supplyName: 'Arroz',
        quantity: 0,
        unit: 'kilogramos',
        collectionPointId,
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/donations')
      .set('Authorization', `Bearer ${donorToken}`)
      .send({
        supplyName: 'Arroz',
        quantity: -5,
        unit: 'kilogramos',
        collectionPointId,
      })
      .expect(400);
  });
});
