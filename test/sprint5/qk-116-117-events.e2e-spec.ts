/**
 * QK-116/QK-117 · Gestionar Eventos y Registrar Asistencia — a nivel de
 * persistencia (RLS y FKs reales), no de negocio: eso ya lo cubren los
 * escenarios de aceptación. Acá lo que importa es que el aislamiento entre
 * organizaciones y el conteo interno resistan un ataque directo a la base.
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

interface EventBody {
  id: string;
  name: string;
  kind: 'periodic' | 'one_off';
  startDate: string;
  startTime: string;
  weekdays: number[] | null;
}

function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Cordoba',
  }).format(new Date());
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

describe('QK-116/QK-117 Eventos y Asistencia — aislamiento (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ownerAToken: string;
  let ownerBToken: string;
  let volunteerAToken: string;
  let orgAId: string;
  let eventAId: string;
  const orgIds: string[] = [];
  const emails: string[] = [];

  beforeAll(async () => {
    ({ app, dataSource } = await bootstrapApp());

    const ownerAEmail = uniqueEmail('qk116-owner-a');
    emails.push(ownerAEmail);
    const ownerA = await registerAndLogin(app, ownerAEmail);
    const orgA = await createOrganization(app, ownerA.token, {
      name: 'Comedor A',
    });
    orgAId = orgA.id;
    orgIds.push(orgA.id);
    ownerAToken = await switchOrg(app, ownerA.token, orgA.id);

    const ownerBEmail = uniqueEmail('qk116-owner-b');
    emails.push(ownerBEmail);
    const ownerB = await registerAndLogin(app, ownerBEmail);
    const orgB = await createOrganization(app, ownerB.token, {
      name: 'Comedor B',
    });
    orgIds.push(orgB.id);
    ownerBToken = await switchOrg(app, ownerB.token, orgB.id);

    const volunteerEmail = uniqueEmail('qk116-voluntario');
    emails.push(volunteerEmail);
    const volunteer = await registerAndLogin(app, volunteerEmail);
    await dataSource.query(
      `INSERT INTO organization_memberships ("userId", "organizationId", role, active)
       VALUES ($1, $2, 'voluntario', true)`,
      [volunteer.userId, orgA.id],
    );
    volunteerAToken = await switchOrg(app, volunteer.token, orgA.id);

    const created = await request(app.getHttpServer())
      .post('/events')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        name: 'Merienda diaria',
        kind: 'periodic',
        startDate: today(),
        startTime: '17:00',
        weekdays: [0, 1, 2, 3, 4, 5, 6],
      })
      .expect(201);
    eventAId = (created.body as EventBody).id;
  });

  afterAll(async () => {
    await cleanupOrganizations(dataSource, orgIds);
    await cleanupUsers(dataSource, emails);
    await app.close();
  });

  it('la organización B no ve el evento de la organización A en su listado', async () => {
    const res = await request(app.getHttpServer())
      .get('/events')
      .set('Authorization', `Bearer ${ownerBToken}`)
      .expect(200);

    expect((res.body as EventBody[]).some((e) => e.id === eventAId)).toBe(
      false,
    );
  });

  it('la organización B recibe 404 al cargar asistencia en el evento de A', async () => {
    await request(app.getHttpServer())
      .put(`/events/${eventAId}/attendance/${today()}`)
      .set('Authorization', `Bearer ${ownerBToken}`)
      .send({ count: 10 })
      .expect(404);
  });

  it('la organización B recibe 404 al dar de baja el evento de A', async () => {
    await request(app.getHttpServer())
      .patch(`/events/${eventAId}/deactivate`)
      .set('Authorization', `Bearer ${ownerBToken}`)
      .expect(404);
  });

  it('la organización B recibe 404 al pedir las ocurrencias del evento de A', async () => {
    await request(app.getHttpServer())
      .get(`/events/${eventAId}/occurrences`)
      .set('Authorization', `Bearer ${ownerBToken}`)
      .expect(404);
  });

  it('un voluntario no puede crear eventos pero sí cargar asistencia', async () => {
    await request(app.getHttpServer())
      .post('/events')
      .set('Authorization', `Bearer ${volunteerAToken}`)
      .send({
        name: 'Colecta',
        kind: 'one_off',
        startDate: today(),
        startTime: '10:00',
      })
      .expect(403);

    await request(app.getHttpServer())
      .put(`/events/${eventAId}/attendance/${today()}`)
      .set('Authorization', `Bearer ${volunteerAToken}`)
      .send({ count: 12 })
      .expect(200);
  });

  it('la ficha pública de la organización A no expone datos de asistencia', async () => {
    const res = await request(app.getHttpServer())
      .get(`/public/organizations/${orgAId}`)
      .expect(200);

    const crudo = JSON.stringify(res.body);
    expect(crudo).not.toContain('attendance');
    expect(crudo).not.toContain('attendances');
  });

  it('rechaza con 400 la asistencia en un día de la semana que el evento no tiene', async () => {
    // Un solo día de la semana: el de ayer. Hoy queda afuera sin importar qué día sea.
    const yesterday = addDays(today(), -1);
    const [y, m, d] = yesterday.split('-').map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const created = await request(app.getHttpServer())
      .post('/events')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        name: 'Apoyo escolar',
        kind: 'periodic',
        startDate: addDays(today(), -7),
        startTime: '14:00',
        weekdays: [weekday],
      })
      .expect(201);
    const id = (created.body as EventBody).id;

    await request(app.getHttpServer())
      .put(`/events/${id}/attendance/${today()}`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ count: 3 })
      .expect(400);
    await request(app.getHttpServer())
      .put(`/events/${id}/attendance/${yesterday}`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ count: 3 })
      .expect(200);
  });

  it('la hora vuelve como HH:MM y los días como números', async () => {
    const res = await request(app.getHttpServer())
      .get('/events')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .expect(200);
    const event = (res.body as EventBody[]).find((e) => e.id === eventAId);
    expect(event?.startTime).toBe('17:00');
    expect(event?.weekdays).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it.each([
    ['periódico sin días', 'periodic', "'{}'"],
    ['periódico con un día fuera de 0..6', 'periodic', "'{1,7}'"],
    ['periódico con días en null', 'periodic', 'NULL'],
    ['extraordinario con días', 'one_off', "'{1}'"],
  ])(
    'CHK_events_weekdays rechaza un %s aunque se escriba directo en la base',
    async (_label, kind, weekdays) => {
      await expect(
        dataSource.query(
          `INSERT INTO events ("organizationId", name, kind, "startDate", "startTime", weekdays)
           VALUES ($1, 'Directo', $2, CURRENT_DATE, '10:00', ${weekdays}::smallint[])`,
          [orgAId, kind],
        ),
      ).rejects.toThrow(/CHK_events_weekdays/);
    },
  );
});
