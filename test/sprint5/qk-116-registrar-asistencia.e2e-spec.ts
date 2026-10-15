/**
 * QK-116 · Registrar asistencia — CP-116-01 a CP-116-08
 * Casos tal como figuran en "DOC TESTEO BACK Sprint 5.pdf" (backend, capa API/DB).
 * Trazabilidad QA aparte de `test/sprint5/qk-116-117-events.e2e-spec.ts`
 * (suite de aislamiento/RLS del equipo) — no se toca ese archivo.
 *
 * Contrato real verificado en `event.controller.ts` / `event.service.ts` /
 * `update-attendance.dto.ts`: `PUT /events/:id/attendance/:date` no lleva
 * `@Roles()` (cualquier miembro activo, incluido el voluntario, carga el
 * conteo); hace upsert por `(eventId, date)`; valida que la fecha no sea
 * futura y que sea una ocurrencia real del evento (ver `isOccurrence`).
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  addDays,
  addMembership,
  bootstrapApp,
  cleanupOrganizations,
  cleanupUsers,
  createOrganization,
  deactivateEventOn,
  messagesOf,
  registerAndLogin,
  switchOrg,
  today,
  uniqueEmail,
} from './helpers';

const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

interface EventBody {
  id: string;
}
interface Occurrence {
  date: string;
  count: number | null;
}
interface AttendanceResult {
  eventId: string;
  date: string;
  count: number;
}

describe('QK-116 · Registrar asistencia (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const emails: string[] = [];
  const orgIds: string[] = [];

  function putAttendance(
    token: string,
    eventId: string,
    date: string,
    body: Record<string, unknown>,
  ) {
    return request(app.getHttpServer())
      .put(`/events/${eventId}/attendance/${date}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }
  function occurrences(token: string, eventId: string) {
    return request(app.getHttpServer())
      .get(`/events/${eventId}/occurrences`)
      .set('Authorization', `Bearer ${token}`);
  }

  async function newOrg(prefix: string, name?: string) {
    const email = uniqueEmail(prefix);
    emails.push(email);
    const owner = await registerAndLogin(app, email);
    const org = await createOrganization(app, owner.token, {
      name: name ?? 'Comedor QA Asistencia',
    });
    orgIds.push(org.id);
    const orgToken = await switchOrg(app, owner.token, org.id);
    return { orgId: org.id, orgToken };
  }

  async function newPeriodicEvent(
    orgToken: string,
    startDate: string,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/events')
      .set('Authorization', `Bearer ${orgToken}`)
      .send({
        name: 'Merienda diaria',
        kind: 'periodic',
        startDate,
        startTime: '10:00',
        weekdays: ALL_WEEKDAYS,
      })
      .expect(201);
    return (res.body as EventBody).id;
  }

  beforeAll(async () => {
    ({ app, dataSource } = await bootstrapApp());
  });

  afterAll(async () => {
    await cleanupOrganizations(dataSource, orgIds);
    await cleanupUsers(dataSource, emails);
    await app.close();
  });

  it('CP-116-01: registra el conteo de una ocurrencia y aparece en el historial interno', async () => {
    const { orgToken } = await newOrg('cp116-01');
    const eventId = await newPeriodicEvent(orgToken, addDays(today(), -2));

    const res = await putAttendance(orgToken, eventId, today(), {
      count: 42,
    }).expect(200);
    expect(res.body as AttendanceResult).toEqual({
      eventId,
      date: today(),
      count: 42,
    });

    const occ = await occurrences(orgToken, eventId).expect(200);
    const byDate = new Map(
      (occ.body as Occurrence[]).map((o) => [o.date, o.count]),
    );
    expect(byDate.get(today())).toBe(42);
    expect(byDate.get(addDays(today(), -2))).toBeNull();
    expect(byDate.get(addDays(today(), -1))).toBeNull();
  });

  it('CP-116-02: corregir un conteo ya cargado reemplaza el valor anterior sin duplicar el registro', async () => {
    const { orgToken } = await newOrg('cp116-02');
    const eventId = await newPeriodicEvent(orgToken, today());
    await putAttendance(orgToken, eventId, today(), { count: 42 }).expect(
      200,
    );

    await putAttendance(orgToken, eventId, today(), { count: 50 }).expect(
      200,
    );

    const occ = await occurrences(orgToken, eventId).expect(200);
    const todayOcc = (occ.body as Occurrence[]).find(
      (o) => o.date === today(),
    );
    expect(todayOcc?.count).toBe(50);

    const rows = await dataSource.query(
      `SELECT count(*)::int AS n FROM event_attendances WHERE "eventId" = $1 AND date = $2`,
      [eventId, today()],
    );
    expect(rows[0].n).toBe(1);
  });

  it('CP-116-03: el conteo de asistencia no se expone en la ficha pública de la organización', async () => {
    const { orgId, orgToken } = await newOrg('cp116-03');
    const eventId = await newPeriodicEvent(orgToken, today());
    await putAttendance(orgToken, eventId, today(), { count: 7 }).expect(
      200,
    );

    const res = await request(app.getHttpServer())
      .get(`/public/organizations/${orgId}`)
      .expect(200);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('attendance');
    expect(raw).not.toContain('attendances');
  });

  it('CP-116-04: cualquier miembro activo, incluido el voluntario, puede cargar el conteo; sin sesión no se puede', async () => {
    const { orgId, orgToken } = await newOrg('cp116-04');
    const eventId = await newPeriodicEvent(orgToken, today());

    const volunteerEmail = uniqueEmail('cp116-04-vol');
    emails.push(volunteerEmail);
    const volunteer = await registerAndLogin(app, volunteerEmail);
    await addMembership(dataSource, volunteer.userId, orgId, 'voluntario');
    const volunteerToken = await switchOrg(app, volunteer.token, orgId);

    await putAttendance(volunteerToken, eventId, today(), {
      count: 15,
    }).expect(200);

    await request(app.getHttpServer())
      .put(`/events/${eventId}/attendance/${today()}`)
      .send({ count: 99 })
      .expect(401);

    const occ = await occurrences(orgToken, eventId).expect(200);
    const todayOcc = (occ.body as Occurrence[]).find(
      (o) => o.date === today(),
    );
    expect(todayOcc?.count).toBe(15);
  });

  it('CP-116-05: una organización no puede cargar asistencia en un evento de otra', async () => {
    const orgA = await newOrg('cp116-05-a', 'Comedor A');
    const eventAId = await newPeriodicEvent(orgA.orgToken, today());
    const orgB = await newOrg('cp116-05-b', 'Comedor B');

    const res = await putAttendance(orgB.orgToken, eventAId, today(), {
      count: 99,
    }).expect(404);
    expect((res.body as { message: string }).message).toBe(
      'El evento no existe.',
    );

    const occ = await occurrences(orgA.orgToken, eventAId).expect(200);
    const todayOcc = (occ.body as Occurrence[]).find(
      (o) => o.date === today(),
    );
    expect(todayOcc?.count).toBeNull();
  });

  it('CP-116-06: no se puede cargar asistencia de un día que todavía no llegó', async () => {
    const { orgToken } = await newOrg('cp116-06');
    const eventId = await newPeriodicEvent(orgToken, addDays(today(), -5));

    const res = await putAttendance(
      orgToken,
      eventId,
      addDays(today(), 1),
      { count: 10 },
    ).expect(400);
    expect((res.body as { message: string }).message).toBe(
      'No se puede cargar asistencia de una fecha futura.',
    );
  });

  it('CP-116-07: solo se puede cargar asistencia en fechas que son ocurrencias reales del evento', async () => {
    const extra = await newOrg('cp116-07-extra', 'Comedor Extraordinario');
    const extraRes = await request(app.getHttpServer())
      .post('/events')
      .set('Authorization', `Bearer ${extra.orgToken}`)
      .send({
        name: 'Colecta puntual',
        kind: 'one_off',
        startDate: addDays(today(), -2),
        startTime: '10:00',
      })
      .expect(201);
    const extraordinarioId = (extraRes.body as EventBody).id;

    const periodico = await newOrg('cp116-07-periodico', 'Comedor Periódico');
    const periodicoId = await newPeriodicEvent(
      periodico.orgToken,
      addDays(today(), -5),
    );
    await deactivateEventOn(dataSource, periodicoId, addDays(today(), -2));

    const r1 = await putAttendance(
      extra.orgToken,
      extraordinarioId,
      addDays(today(), -3),
      { count: 1 },
    ).expect(400);
    expect((r1.body as { message: string }).message).toBe(
      'Esa fecha no corresponde a una ocurrencia del evento.',
    );

    const r2 = await putAttendance(
      periodico.orgToken,
      periodicoId,
      addDays(today(), -6),
      { count: 1 },
    ).expect(400);
    expect((r2.body as { message: string }).message).toBe(
      'Esa fecha no corresponde a una ocurrencia del evento.',
    );

    const r3 = await putAttendance(
      periodico.orgToken,
      periodicoId,
      addDays(today(), -1),
      { count: 1 },
    ).expect(400);
    expect((r3.body as { message: string }).message).toBe(
      'Esa fecha no corresponde a una ocurrencia del evento.',
    );
  });

  it('CP-116-08: valida el conteo y la fecha de la ruta', async () => {
    const { orgToken } = await newOrg('cp116-08');
    const eventId = await newPeriodicEvent(orgToken, addDays(today(), -5));

    const negative = await putAttendance(orgToken, eventId, today(), {
      count: -1,
    }).expect(400);
    expect(messagesOf(negative.body)).toContain(
      'El conteo no puede ser negativo.',
    );

    const notInteger = await putAttendance(orgToken, eventId, today(), {
      count: 4.5,
    }).expect(400);
    expect(messagesOf(notInteger.body)).toContain(
      'El conteo debe ser un número entero.',
    );

    const notNumber = await putAttendance(orgToken, eventId, today(), {
      count: 'abc',
    }).expect(400);
    expect(messagesOf(notNumber.body)).toContain(
      'El conteo debe ser un número entero.',
    );

    const invalidCalendarDate = await putAttendance(
      orgToken,
      eventId,
      '2026-02-30',
      { count: 5 },
    ).expect(400);
    expect((invalidCalendarDate.body as { message: string }).message).toBe(
      'La fecha debe ser una fecha real con formato AAAA-MM-DD.',
    );

    const invalidFormat = await putAttendance(
      orgToken,
      eventId,
      '05-10-2026',
      { count: 5 },
    ).expect(400);
    expect((invalidFormat.body as { message: string }).message).toBe(
      'La fecha debe ser una fecha real con formato AAAA-MM-DD.',
    );
  });
});
