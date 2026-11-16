/**
 * Asociar necesidades y actividades de voluntariado a un evento — a nivel de
 * persistencia (FK compuesta real) y de ficha pública. Las reglas de negocio
 * (404 / 409) las cubren los unit tests de los services.
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

interface Id {
  id: string;
}

interface PublicDetail {
  events: { id: string; name: string }[];
  needs: { id: string; eventId: string | null; eventName: string | null }[];
  volunteering: {
    opportunities: {
      id: string;
      eventId: string | null;
      eventName: string | null;
    }[];
  };
}

function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Cordoba',
  }).format(new Date());
}

describe('Eventos asociados a necesidades y voluntariado (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ownerAToken: string;
  let ownerBToken: string;
  let orgAId: string;
  let eventAId: string;
  let eventBId: string;
  let supplyAId: string;
  const orgIds: string[] = [];
  const emails: string[] = [];

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const needBody = (eventId?: string | null) => ({
    supplyId: supplyAId,
    requiredQuantity: 20,
    deadline: '2099-12-31',
    ...(eventId !== undefined && { eventId }),
  });
  const opportunityBody = (eventId?: string | null) => ({
    title: 'Merienda del sábado',
    description: 'Servimos la merienda a 80 chicos del barrio.',
    startsAt: '2099-09-12T17:00:00.000Z',
    location: 'Bv. Sarmiento 1450, Villa María',
    capacity: 4,
    ...(eventId !== undefined && { eventId }),
  });

  async function createEvent(token: string, name: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/events')
      .set(auth(token))
      .send({
        name,
        kind: 'periodic',
        startDate: today(),
        startTime: '17:00',
        weekdays: [0, 1, 2, 3, 4, 5, 6],
      })
      .expect(201);
    return (res.body as Id).id;
  }

  beforeAll(async () => {
    ({ app, dataSource } = await bootstrapApp());

    const emailA = uniqueEmail('evlinks-a');
    emails.push(emailA);
    const sessionA = await registerAndLogin(app, emailA);
    const orgA = await createOrganization(app, sessionA.token, {
      name: 'Comedor A',
    });
    orgAId = orgA.id;
    orgIds.push(orgA.id);
    ownerAToken = await switchOrg(app, sessionA.token, orgA.id);
    await dataSource.query(
      `UPDATE organizations SET "seeksVolunteers" = true WHERE id = $1`,
      [orgA.id],
    );

    const emailB = uniqueEmail('evlinks-b');
    emails.push(emailB);
    const sessionB = await registerAndLogin(app, emailB);
    const orgB = await createOrganization(app, sessionB.token, {
      name: 'Comedor B',
    });
    orgIds.push(orgB.id);
    ownerBToken = await switchOrg(app, sessionB.token, orgB.id);

    eventAId = await createEvent(ownerAToken, 'Merienda diaria');
    eventBId = await createEvent(ownerBToken, 'Evento de B');

    const supply = await request(app.getHttpServer())
      .post('/supplies')
      .set(auth(ownerAToken))
      .send({ name: 'Arroz', category: 'Alimentos secos', unit: 'Kilogramos' })
      .expect(201);
    supplyAId = (supply.body as Id).id;
  });

  afterAll(async () => {
    await cleanupOrganizations(dataSource, orgIds);
    await cleanupUsers(dataSource, emails);
    await app.close();
  });

  it('una necesidad y una actividad asociadas muestran su evento en la ficha pública', async () => {
    const need = await request(app.getHttpServer())
      .post('/needs')
      .set(auth(ownerAToken))
      .send(needBody(eventAId))
      .expect(201);
    const opportunity = await request(app.getHttpServer())
      .post('/volunteering/opportunities')
      .set(auth(ownerAToken))
      .send(opportunityBody(eventAId))
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/public/organizations/${orgAId}`)
      .expect(200);
    const detail = res.body as PublicDetail;

    expect(detail.events.map((e) => e.id)).toContain(eventAId);
    expect(
      detail.needs.find((n) => n.id === (need.body as Id).id),
    ).toMatchObject({ eventId: eventAId, eventName: 'Merienda diaria' });
    expect(
      detail.volunteering.opportunities.find(
        (o) => o.id === (opportunity.body as Id).id,
      ),
    ).toMatchObject({ eventId: eventAId, eventName: 'Merienda diaria' });
  });

  it('desasociar con eventId null deja la necesidad sin evento', async () => {
    const created = await request(app.getHttpServer())
      .post('/needs')
      .set(auth(ownerAToken))
      .send(needBody(eventAId))
      .expect(201);
    const id = (created.body as Id).id;

    const updated = await request(app.getHttpServer())
      .put(`/needs/${id}`)
      .set(auth(ownerAToken))
      .send(needBody(null))
      .expect(200);

    expect((updated.body as { eventId: string | null }).eventId).toBeNull();
  });

  it('el evento de otra organización se rechaza con 404, sin llegar a la FK', async () => {
    await request(app.getHttpServer())
      .post('/needs')
      .set(auth(ownerAToken))
      .send(needBody(eventBId))
      .expect(404);
    await request(app.getHttpServer())
      .post('/volunteering/opportunities')
      .set(auth(ownerAToken))
      .send(opportunityBody(eventBId))
      .expect(404);
  });

  it('la FK compuesta rechaza apuntar directo (SQL) al evento de otra organización', async () => {
    const created = await request(app.getHttpServer())
      .post('/needs')
      .set(auth(ownerAToken))
      .send(needBody())
      .expect(201);

    await expect(
      dataSource.query(`UPDATE needs SET "eventId" = $1 WHERE id = $2`, [
        eventBId,
        (created.body as Id).id,
      ]),
    ).rejects.toThrow(/FK_needs_event/);
  });

  it('un evento dado de baja conserva lo asociado pero no admite asociaciones nuevas', async () => {
    const eventId = await createEvent(ownerAToken, 'Evento que se da de baja');
    const created = await request(app.getHttpServer())
      .post('/needs')
      .set(auth(ownerAToken))
      .send(needBody(eventId))
      .expect(201);
    const id = (created.body as Id).id;

    await request(app.getHttpServer())
      .patch(`/events/${eventId}/deactivate`)
      .set(auth(ownerAToken))
      .expect(200);

    // La asociación que ya existía se puede mantener al editar...
    await request(app.getHttpServer())
      .put(`/needs/${id}`)
      .set(auth(ownerAToken))
      .send({ ...needBody(eventId), requiredQuantity: 25 })
      .expect(200);
    // ...pero no se puede estrenar una nueva.
    await request(app.getHttpServer())
      .post('/needs')
      .set(auth(ownerAToken))
      .send(needBody(eventId))
      .expect(409);
  });
});
