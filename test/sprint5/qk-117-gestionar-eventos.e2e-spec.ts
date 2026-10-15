/**
 * QK-117 · Gestionar eventos — CP-117-01 a CP-117-09
 * Casos tal como figuran en "DOC TESTEO BACK Sprint 5.pdf" (backend, capa API/DB).
 * Trazabilidad QA aparte de `test/sprint5/qk-116-117-events.e2e-spec.ts`
 * (suite de aislamiento/RLS del equipo) — no se toca ese archivo.
 *
 * Contrato real verificado en `event.controller.ts` / `event.service.ts` /
 * `create-event.dto.ts` / `update-event.dto.ts`:
 *   - `POST /events` y `PUT /events/:id` ahora exigen `startTime` ('HH:MM') y,
 *     para `kind: 'periodic'`, `weekdays` (al menos un día 0-6) — campos que
 *     el documento de Sprint 5 no contemplaba (se agregaron en el commit
 *     `ead00b3`, posterior a la redacción del doc). No es un defecto: es una
 *     ampliación de alcance explícita y documentada en el propio código; acá
 *     se usan valores válidos (`startTime` fijo, `weekdays` con los 7 días)
 *     para poder ejercitar el resto de cada caso sin que la creación del
 *     evento falle por un campo que el caso ni menciona.
 *   - El mensaje de 409 al editar un evento con asistencia también mudó:
 *     ahora nombra la hora y los días de la semana además del tipo/fecha.
 *     Se verifica por substring estable ("ya tiene asistencia registrada"),
 *     no por el texto literal del documento — mismo motivo que arriba.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  addDays,
  bootstrapApp,
  cleanupOrganizations,
  cleanupUsers,
  createOrganization,
  addMembership,
  messagesOf,
  registerAndLogin,
  switchOrg,
  today,
  uniqueEmail,
} from './helpers';

const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

interface EventBody {
  id: string;
  name: string;
  kind: 'periodic' | 'one_off';
  startDate: string;
  active: boolean;
  endedOn: string | null;
}
interface Occurrence {
  date: string;
  count: number | null;
}

describe('QK-117 · Gestionar eventos (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const emails: string[] = [];
  const orgIds: string[] = [];

  function createEvent(token: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/events')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }
  function updateEvent(
    token: string,
    id: string,
    body: Record<string, unknown>,
  ) {
    return request(app.getHttpServer())
      .put(`/events/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }
  function occurrences(token: string, id: string, query: Record<string, string> = {}) {
    return request(app.getHttpServer())
      .get(`/events/${id}/occurrences`)
      .query(query)
      .set('Authorization', `Bearer ${token}`);
  }
  function setAttendance(
    token: string,
    id: string,
    date: string,
    count: number,
  ) {
    return request(app.getHttpServer())
      .put(`/events/${id}/attendance/${date}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ count });
  }

  async function newOrg(prefix: string, name?: string) {
    const email = uniqueEmail(prefix);
    emails.push(email);
    const owner = await registerAndLogin(app, email);
    const org = await createOrganization(app, owner.token, {
      name: name ?? 'Comedor QA Eventos',
    });
    orgIds.push(org.id);
    const orgToken = await switchOrg(app, owner.token, org.id);
    return { orgId: org.id, orgToken, ownerUserId: owner.userId };
  }

  beforeAll(async () => {
    ({ app, dataSource } = await bootstrapApp());
  });

  afterAll(async () => {
    await cleanupOrganizations(dataSource, orgIds);
    await cleanupUsers(dataSource, emails);
    await app.close();
  });

  it('CP-117-01: crea un evento periódico diario con una ocurrencia por cada día desde su inicio hasta hoy', async () => {
    const { orgToken } = await newOrg('cp117-01');
    const created = await createEvent(orgToken, {
      name: 'Merienda diaria',
      kind: 'periodic',
      startDate: addDays(today(), -2),
      startTime: '10:00',
      weekdays: ALL_WEEKDAYS,
    }).expect(201);
    const event = created.body as EventBody;
    expect(event.active).toBe(true);
    expect(event.endedOn).toBeNull();

    const occ = await occurrences(orgToken, event.id).expect(200);
    const dates = (occ.body as Occurrence[]).map((o) => o.date);
    expect(dates).toEqual([addDays(today(), -2), addDays(today(), -1), today()]);
    expect((occ.body as Occurrence[]).every((o) => o.count === null)).toBe(
      true,
    );
  });

  it('CP-117-02: crea un evento extraordinario con una única ocurrencia en su fecha puntual', async () => {
    const { orgToken } = await newOrg('cp117-02');
    const created = await createEvent(orgToken, {
      name: 'Colecta de invierno',
      kind: 'one_off',
      startDate: addDays(today(), 5),
      startTime: '10:00',
    }).expect(201);
    const event = created.body as EventBody;

    const occ = await occurrences(orgToken, event.id, {
      from: today(),
      to: addDays(today(), 10),
    }).expect(200);
    const rows = occ.body as Occurrence[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ date: addDays(today(), 5), count: null });
  });

  it('CP-117-03: un evento sin asistencia registrada se puede editar sin restricciones', async () => {
    const { orgToken } = await newOrg('cp117-03');
    const created = await createEvent(orgToken, {
      name: 'Merienda diaria',
      kind: 'periodic',
      startDate: today(),
      startTime: '10:00',
      weekdays: ALL_WEEKDAYS,
    }).expect(201);
    const id = (created.body as EventBody).id;

    await updateEvent(orgToken, id, {
      name: 'Merienda de la tarde',
      kind: 'one_off',
      startDate: addDays(today(), 1),
    }).expect(200);

    const list = await request(app.getHttpServer())
      .get('/events')
      .set('Authorization', `Bearer ${orgToken}`)
      .expect(200);
    const event = (list.body as EventBody[]).find((e) => e.id === id);
    expect(event?.name).toBe('Merienda de la tarde');
    expect(event?.kind).toBe('one_off');
    expect(event?.startDate).toBe(addDays(today(), 1));
  });

  it('CP-117-04: un evento con asistencia registrada solo permite renombrarse', async () => {
    const { orgToken } = await newOrg('cp117-04');
    const created = await createEvent(orgToken, {
      name: 'Merienda diaria',
      kind: 'periodic',
      startDate: today(),
      startTime: '10:00',
      weekdays: ALL_WEEKDAYS,
    }).expect(201);
    const id = (created.body as EventBody).id;
    await setAttendance(orgToken, id, today(), 20).expect(200);

    const body1 = await updateEvent(orgToken, id, { kind: 'one_off' }).expect(
      409,
    );
    expect(messagesOf(body1.body)[0]).toContain(
      'ya tiene asistencia registrada',
    );

    const body2 = await updateEvent(orgToken, id, {
      startDate: addDays(today(), -5),
    }).expect(409);
    expect(messagesOf(body2.body)[0]).toContain(
      'ya tiene asistencia registrada',
    );

    await updateEvent(orgToken, id, { name: 'Merienda de la tarde' }).expect(
      200,
    );

    const occ = await occurrences(orgToken, id).expect(200);
    const todayOcc = (occ.body as Occurrence[]).find((o) => o.date === today());
    expect(todayOcc?.count).toBe(20);
  });

  it('CP-117-05: dar de baja un evento periódico corta ocurrencias nuevas y conserva lo ya registrado', async () => {
    const { orgToken } = await newOrg('cp117-05');
    const created = await createEvent(orgToken, {
      name: 'Merienda diaria',
      kind: 'periodic',
      startDate: addDays(today(), -3),
      startTime: '10:00',
      weekdays: ALL_WEEKDAYS,
    }).expect(201);
    const id = (created.body as EventBody).id;
    await setAttendance(orgToken, id, addDays(today(), -2), 30).expect(200);

    const first = await request(app.getHttpServer())
      .patch(`/events/${id}/deactivate`)
      .set('Authorization', `Bearer ${orgToken}`)
      .expect(200);
    const deactivated = first.body as EventBody;
    expect(deactivated.active).toBe(false);
    expect(deactivated.endedOn).toBe(today());

    const occ = await occurrences(orgToken, id).expect(200);
    const dates = (occ.body as Occurrence[]).map((o) => o.date);
    expect(dates).toEqual([
      addDays(today(), -3),
      addDays(today(), -2),
      addDays(today(), -1),
      today(),
    ]);
    const minus2 = (occ.body as Occurrence[]).find(
      (o) => o.date === addDays(today(), -2),
    );
    expect(minus2?.count).toBe(30);

    const second = await request(app.getHttpServer())
      .patch(`/events/${id}/deactivate`)
      .set('Authorization', `Bearer ${orgToken}`)
      .expect(200);
    expect((second.body as EventBody).endedOn).toBe(today());
  });

  it('CP-117-06: aislamiento entre organizaciones — cada una lista solo sus eventos y no puede operar sobre los de otra', async () => {
    const orgA = await newOrg('cp117-06-a', 'Comedor A');
    const createdA = await createEvent(orgA.orgToken, {
      name: 'Merienda diaria',
      kind: 'periodic',
      startDate: today(),
      startTime: '10:00',
      weekdays: ALL_WEEKDAYS,
    }).expect(201);
    const eventAId = (createdA.body as EventBody).id;

    const orgB = await newOrg('cp117-06-b', 'Comedor B');

    const listA = await request(app.getHttpServer())
      .get('/events')
      .set('Authorization', `Bearer ${orgA.orgToken}`)
      .expect(200);
    expect(
      (listA.body as EventBody[]).map((e) => e.name),
    ).toEqual(['Merienda diaria']);

    const put = await updateEvent(orgB.orgToken, eventAId, {
      name: 'Hackeado',
    }).expect(404);
    expect((put.body as { message: string }).message).toBe(
      'El evento no existe.',
    );
    await request(app.getHttpServer())
      .patch(`/events/${eventAId}/deactivate`)
      .set('Authorization', `Bearer ${orgB.orgToken}`)
      .expect(404);
    await occurrences(orgB.orgToken, eventAId).expect(404);

    const stillA = await request(app.getHttpServer())
      .get('/events')
      .set('Authorization', `Bearer ${orgA.orgToken}`)
      .expect(200);
    expect(
      (stillA.body as EventBody[]).find((e) => e.id === eventAId)?.name,
    ).toBe('Merienda diaria');
  });

  it('CP-117-07: permisos por rol — solo owner/admin/coordinador administran, el voluntario solo consulta', async () => {
    const org = await newOrg('cp117-07');
    const created = await createEvent(org.orgToken, {
      name: 'Merienda diaria',
      kind: 'periodic',
      startDate: today(),
      startTime: '10:00',
      weekdays: ALL_WEEKDAYS,
    }).expect(201);
    const id = (created.body as EventBody).id;

    const volunteerEmail = uniqueEmail('cp117-07-vol');
    emails.push(volunteerEmail);
    const volunteer = await registerAndLogin(app, volunteerEmail);
    await addMembership(dataSource, volunteer.userId, org.orgId, 'voluntario');
    const volunteerToken = await switchOrg(app, volunteer.token, org.orgId);

    await createEvent(volunteerToken, {
      name: 'Otro evento',
      kind: 'one_off',
      startDate: today(),
      startTime: '10:00',
    }).expect(403);
    await updateEvent(volunteerToken, id, { name: 'No debería aplicar' }).expect(
      403,
    );
    await request(app.getHttpServer())
      .patch(`/events/${id}/deactivate`)
      .set('Authorization', `Bearer ${volunteerToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .get('/events')
      .set('Authorization', `Bearer ${volunteerToken}`)
      .expect(200);
    await request(app.getHttpServer()).get('/events').expect(401);
  });

  it('CP-117-08: valida la entrada al crear un evento', async () => {
    const { orgToken } = await newOrg('cp117-08');
    const base = {
      kind: 'periodic' as const,
      startDate: today(),
      startTime: '10:00',
      weekdays: ALL_WEEKDAYS,
    };

    const blankName = await createEvent(orgToken, {
      ...base,
      name: '   ',
    }).expect(400);
    expect(messagesOf(blankName.body)).toContain('Ingresá el nombre del evento.');

    const longName = await createEvent(orgToken, {
      ...base,
      name: 'x'.repeat(121),
    }).expect(400);
    expect(messagesOf(longName.body)).toContain(
      'El nombre no puede superar los 120 caracteres.',
    );

    const invalidKind = await createEvent(orgToken, {
      name: 'Evento QA',
      kind: 'weekly',
      startDate: today(),
      startTime: '10:00',
    }).expect(400);
    expect(messagesOf(invalidKind.body)).toContain(
      'Elegí un tipo de evento válido.',
    );

    const invalidCalendarDate = await createEvent(orgToken, {
      ...base,
      name: 'Evento QA',
      startDate: '2026-02-30',
    }).expect(400);
    expect(messagesOf(invalidCalendarDate.body).length).toBeGreaterThan(0);

    const invalidFormatDate = await createEvent(orgToken, {
      ...base,
      name: 'Evento QA',
      startDate: '2026-10-05T03:00:00Z',
    }).expect(400);
    expect(messagesOf(invalidFormatDate.body)).toContain(
      'La fecha de inicio debe tener el formato AAAA-MM-DD.',
    );

    const list = await request(app.getHttpServer())
      .get('/events')
      .set('Authorization', `Bearer ${orgToken}`)
      .expect(200);
    expect(list.body as EventBody[]).toEqual([]);
  });

  it('CP-117-09: rango por defecto y límites de la consulta de ocurrencias', async () => {
    const { orgToken } = await newOrg('cp117-09');
    const created = await createEvent(orgToken, {
      name: 'Merienda diaria',
      kind: 'periodic',
      startDate: addDays(today(), -60),
      startTime: '10:00',
      weekdays: ALL_WEEKDAYS,
    }).expect(201);
    const id = (created.body as EventBody).id;

    const def = await occurrences(orgToken, id).expect(200);
    const dates = (def.body as Occurrence[]).map((o) => o.date);
    expect(dates).toHaveLength(30);
    expect(dates[0]).toBe(addDays(today(), -29));
    expect(dates[29]).toBe(today());

    const badRange = await occurrences(orgToken, id, {
      from: today(),
      to: addDays(today(), -1),
    }).expect(400);
    expect((badRange.body as { message: string }).message).toBe(
      'La fecha "desde" no puede ser posterior a "hasta".',
    );

    await occurrences(orgToken, id, {
      from: addDays(today(), -400),
      to: today(),
    }).expect(400);
  });
});
