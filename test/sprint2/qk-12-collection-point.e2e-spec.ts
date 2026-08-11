/**
 * QK-12 · Administrar Punto Recolección — CP-12-01 a CP-12-05
 * Casos tal como figuran en "Documentación del sprint 2 - Equipo 14.pdf".
 *
 * Nota de trazabilidad: el PDF describe "aparece/deja de ofrecerse al
 * coordinar una donación". Ese flujo (QK-26) no existe todavía en el código
 * (ver qk-26-donation.e2e-spec.ts), así que se usa como proxy el propio
 * listado `GET /collection-points`, que es lo más cercano que expone hoy la
 * API. Tampoco existe un endpoint público de puntos de recolección para el
 * donante (el módulo `public` solo expone organizaciones y necesidades) —
 * se deja constancia en el informe final, no es algo que este spec pueda
 * ejercitar.
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

const FULL_WEEK_SCHEDULE = Array.from({ length: 7 }, (_, day) => ({
  day,
  closed: false,
  open: '09:00',
  close: '17:00',
}));

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Sede Central',
    addressLine: 'Bv. Sarmiento 1450, Villa María, Córdoba',
    latitude: -32.4083,
    longitude: -63.2402,
    phone: '353 412-7788',
    email: 'sede@comedor.org',
    contactName: 'Juana Pérez',
    schedule: FULL_WEEK_SCHEDULE,
    ...overrides,
  };
}

describe('QK-12 Administrar Punto Recolección (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;
  const orgIds: string[] = [];
  const emails: string[] = [];

  beforeAll(async () => {
    ({ app, dataSource } = await bootstrapApp());

    const email = uniqueEmail('qk12-owner');
    emails.push(email);
    const session = await registerAndLogin(app, email);
    const org = await createOrganization(app, session.token);
    orgIds.push(org.id);
    token = await switchOrg(app, session.token, org.id);
  });

  afterAll(async () => {
    await cleanupOrganizations(dataSource, orgIds);
    await cleanupUsers(dataSource, emails);
    await app.close();
  });

  it('CP-12-01: crea un punto de recolección y queda disponible/visible', async () => {
    const res = await request(app.getHttpServer())
      .post('/collection-points')
      .set('Authorization', `Bearer ${token}`)
      .send(basePayload())
      .expect(201);

    const created = res.body as { id: string; active: boolean };
    expect(created.active).toBe(true);

    const list = await request(app.getHttpServer())
      .get('/collection-points')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const points = list.body as Array<{ id: string; name: string }>;
    expect(
      points.some((p) => p.id === created.id && p.name === 'Sede Central'),
    ).toBe(true);
  });

  it('CP-12-02: edita el horario y se refleja en el listado', async () => {
    const created = await request(app.getHttpServer())
      .post('/collection-points')
      .set('Authorization', `Bearer ${token}`)
      .send(basePayload({ name: 'Depósito Editable' }))
      .expect(201);

    const id = (created.body as { id: string }).id;
    const newSchedule = FULL_WEEK_SCHEDULE.map((d) => ({
      ...d,
      open: '08:00',
      close: '20:00',
    }));

    await request(app.getHttpServer())
      .put(`/collection-points/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(
        basePayload({ name: 'Depósito Editable', schedule: newSchedule }),
      )
      .expect(200);

    const list = await request(app.getHttpServer())
      .get('/collection-points')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const updated = (
      list.body as Array<{ id: string; schedule: Array<{ open: string }> }>
    ).find((p) => p.id === id);
    expect(updated?.schedule.every((d) => d.open === '08:00')).toBe(true);
  });

  it('CP-12-03: un punto desactivado deja de ofrecerse (queda marcado inactivo)', async () => {
    const created = await request(app.getHttpServer())
      .post('/collection-points')
      .set('Authorization', `Bearer ${token}`)
      .send(basePayload({ name: 'Punto a desactivar' }))
      .expect(201);
    const id = (created.body as { id: string }).id;

    await request(app.getHttpServer())
      .patch(`/collection-points/${id}/deactivate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const list = await request(app.getHttpServer())
      .get('/collection-points')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const found = (
      list.body as Array<{ id: string; active: boolean }>
    ).find((p) => p.id === id);
    expect(found?.active).toBe(false);
  });

  it('CP-12-04: bloquea el guardado con dirección incompleta o inválida', async () => {
    await request(app.getHttpServer())
      .post('/collection-points')
      .set('Authorization', `Bearer ${token}`)
      .send(basePayload({ addressLine: '' }))
      .expect(400);
  });

  it('CP-12-05: valida los campos obligatorios (nombre, horario, contacto)', async () => {
    await request(app.getHttpServer())
      .post('/collection-points')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);
  });
});