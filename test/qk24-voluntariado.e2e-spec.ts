/**
 * QK-24 · Gestionar Voluntariado — trazabilidad CP-24-01 a CP-24-11
 *
 * Suite NUEVA de trazabilidad QA, aparte de
 * `test/sprint3/qk-24-volunteering.e2e-spec.ts` (regresión real del equipo,
 * nombrada PU-1 a PU-4). No se toca ese archivo.
 *
 * Contrato real verificado en `volunteering.controller.ts` /
 * `volunteering.service.ts`:
 *   - `GET /volunteering/opportunities` sin `@Roles`; crear/editar/cerrar/
 *     cancelar con CONTENT_WRITER_ROLES; postularse sin `@Roles` (lo hace
 *     cualquier miembro, típicamente `voluntario`); listar postulaciones y
 *     aceptar/rechazar con CONTENT_WRITER_ROLES.
 *   - El voluntariado es interno: el voluntario es un miembro con rol
 *     `voluntario`, insertado directo en la base (igual que
 *     `qk-24-volunteering.e2e-spec.ts`) — el alta por invitación es QK-15.
 *
 * Divergencia encontrada frente al enunciado de CP-24-03/04 (notificación al
 * aceptar/rechazar una postulación): `VolunteeringService` NO inyecta
 * `MailService` (confirmado por grep: `MailService` solo aparece en
 * `volunteer-request.service.ts`, que es QK-16, otra historia). No hay ningún
 * correo que enviar al aceptar o rechazar una postulación a una oportunidad:
 * la "notificación" es exclusivamente in-app, vía el campo
 * `myApplicationStatus` que devuelve el propio listado. Un `jest.spyOn` sobre
 * `MailService.send` en este flujo no espiaría nada real, así que se decidió
 * no forzarlo — se documenta acá como gap de alcance frente al plan de QA, no
 * como test fallido ni como defecto (nadie prometió el correo en el código).
 *
 * Cierre automático al cubrir el último cupo (CP-24-05): `status` NO cambia
 * solo — sigue en `open` — pero `isOpen` (derivado de `status` + cupos) pasa a
 * `false`. El enunciado del PDF, que asume un estado explícito que cambia
 * solo, no aplica tal cual: se adapta al campo derivado real.
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

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Merienda del sábado',
    description: 'Servimos la merienda a 80 chicos del barrio.',
    startsAt: '2026-09-12T17:00:00.000Z',
    location: 'Bv. Sarmiento 1450, Villa María',
    capacity: 2,
    ...overrides,
  };
}

interface OpportunityBody {
  id: string;
  capacity: number;
  acceptedCount: number;
  status: string;
  isOpen: boolean;
  myApplicationStatus: string | null;
  pendingCount: number;
}

describe('QK-24 · Gestionar Voluntariado — trazabilidad CP-24 (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ownerToken: string;
  let volunteerToken: string;
  let otherVolunteerToken: string;
  let outsiderToken: string;
  const orgIds: string[] = [];
  const emails: string[] = [];

  async function addVolunteerMember(
    userId: string,
    organizationId: string,
  ): Promise<void> {
    await dataSource.query(
      `INSERT INTO organization_memberships ("userId", "organizationId", role, active)
       VALUES ($1, $2, 'voluntario', true)`,
      [userId, organizationId],
    );
  }

  async function createOpportunity(
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/volunteering/opportunities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(basePayload(overrides))
      .expect(201);
    return (res.body as { id: string }).id;
  }

  async function listAs(token: string): Promise<OpportunityBody[]> {
    const res = await request(app.getHttpServer())
      .get('/volunteering/opportunities')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body as OpportunityBody[];
  }

  beforeAll(async () => {
    ({ app, dataSource } = await bootstrapApp());

    const ownerEmail = uniqueEmail('qk24cp-owner');
    emails.push(ownerEmail);
    const owner = await registerAndLogin(app, ownerEmail);
    const org = await createOrganization(app, owner.token);
    orgIds.push(org.id);
    ownerToken = await switchOrg(app, owner.token, org.id);

    const volunteerEmail = uniqueEmail('qk24cp-voluntario');
    emails.push(volunteerEmail);
    const volunteer = await registerAndLogin(app, volunteerEmail);
    await addVolunteerMember(volunteer.userId, org.id);
    volunteerToken = await switchOrg(app, volunteer.token, org.id);

    const otherVolunteerEmail = uniqueEmail('qk24cp-voluntario2');
    emails.push(otherVolunteerEmail);
    const otherVolunteer = await registerAndLogin(app, otherVolunteerEmail);
    await addVolunteerMember(otherVolunteer.userId, org.id);
    otherVolunteerToken = await switchOrg(app, otherVolunteer.token, org.id);

    const outsiderEmail = uniqueEmail('qk24cp-otra-org');
    emails.push(outsiderEmail);
    const outsider = await registerAndLogin(app, outsiderEmail);
    const otherOrg = await createOrganization(app, outsider.token, {
      name: 'Comedor de otra ciudad',
    });
    orgIds.push(otherOrg.id);
    outsiderToken = await switchOrg(app, outsider.token, otherOrg.id);
  });

  afterAll(async () => {
    await cleanupOrganizations(dataSource, orgIds);
    await cleanupUsers(dataSource, emails);
    await app.close();
  });

  it('CP-24-01: crea una actividad con cupos y aparece en el listado del voluntario', async () => {
    const id = await createOpportunity({ title: 'Actividad CP-24-01' });

    const list = await listAs(volunteerToken);
    const found = list.find((o) => o.id === id);

    expect(found).toBeDefined();
    expect(found?.capacity).toBe(2);
    expect(found?.acceptedCount).toBe(0);
    expect(found?.isOpen).toBe(true);
    expect(found?.myApplicationStatus).toBeNull();
  });

  it('CP-24-02: un voluntario se postula a una actividad abierta', async () => {
    const id = await createOpportunity({ title: 'Actividad CP-24-02' });

    await request(app.getHttpServer())
      .post(`/volunteering/opportunities/${id}/applications`)
      .set('Authorization', `Bearer ${volunteerToken}`)
      .expect(201);

    const found = (await listAs(volunteerToken)).find((o) => o.id === id);
    expect(found?.myApplicationStatus).toBe('pending');
  });

  it('CP-24-03: aceptar una postulación baja el cupo y lo refleja in-app (no hay correo: ver header)', async () => {
    const id = await createOpportunity({ title: 'Actividad CP-24-03' });

    await request(app.getHttpServer())
      .post(`/volunteering/opportunities/${id}/applications`)
      .set('Authorization', `Bearer ${volunteerToken}`)
      .expect(201);

    const pending = await request(app.getHttpServer())
      .get(`/volunteering/opportunities/${id}/applications`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const applicationId = (
      pending.body as { id: string; status: string }[]
    )[0].id;

    await request(app.getHttpServer())
      .patch(`/volunteering/applications/${applicationId}/accept`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const asVolunteer = (await listAs(volunteerToken)).find((o) => o.id === id);
    expect(asVolunteer?.myApplicationStatus).toBe('accepted');
    expect(asVolunteer?.acceptedCount).toBe(1);
    expect(asVolunteer?.isOpen).toBe(true); // queda 1 de 2 cupos
  });

  it('CP-24-04: rechazar una postulación no mueve el cupo y lo refleja in-app (no hay correo: ver header)', async () => {
    const id = await createOpportunity({ title: 'Actividad CP-24-04' });

    const application = await request(app.getHttpServer())
      .post(`/volunteering/opportunities/${id}/applications`)
      .set('Authorization', `Bearer ${volunteerToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .patch(
        `/volunteering/applications/${(application.body as { id: string }).id}/reject`,
      )
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const found = (await listAs(volunteerToken)).find((o) => o.id === id);
    expect(found?.myApplicationStatus).toBe('rejected');
    expect(found?.acceptedCount).toBe(0);
    expect(found?.isOpen).toBe(true);
  });

  it('CP-24-05: al cubrirse el último cupo la actividad deja de aceptar postulaciones (isOpen=false, status sigue "open")', async () => {
    const id = await createOpportunity({
      title: 'Actividad CP-24-05',
      capacity: 1,
    });

    const application = await request(app.getHttpServer())
      .post(`/volunteering/opportunities/${id}/applications`)
      .set('Authorization', `Bearer ${volunteerToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .patch(
        `/volunteering/applications/${(application.body as { id: string }).id}/accept`,
      )
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    // Cupo lleno: el segundo voluntario ya no puede postularse.
    await request(app.getHttpServer())
      .post(`/volunteering/opportunities/${id}/applications`)
      .set('Authorization', `Bearer ${otherVolunteerToken}`)
      .expect(409);

    const found = (await listAs(otherVolunteerToken)).find((o) => o.id === id);
    expect(found?.isOpen).toBe(false);
    expect(found?.acceptedCount).toBe(1);
    // El `status` NO se autocierra: sigue "open" aunque no acepte más gente.
    expect(found?.status).toBe('open');
  });

  it('CP-24-06: rechaza una segunda postulación del mismo voluntario a la misma actividad (409)', async () => {
    const id = await createOpportunity({ title: 'Actividad CP-24-06' });

    await request(app.getHttpServer())
      .post(`/volunteering/opportunities/${id}/applications`)
      .set('Authorization', `Bearer ${volunteerToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/volunteering/opportunities/${id}/applications`)
      .set('Authorization', `Bearer ${volunteerToken}`)
      .expect(409);
  });

  it('CP-24-07: un voluntario no puede publicar, editar, cerrar, cancelar ni resolver postulaciones', async () => {
    await request(app.getHttpServer())
      .post('/volunteering/opportunities')
      .set('Authorization', `Bearer ${volunteerToken}`)
      .send(basePayload({ title: 'No debería crearse' }))
      .expect(403);

    const id = await createOpportunity({ title: 'Actividad CP-24-07' });

    await request(app.getHttpServer())
      .put(`/volunteering/opportunities/${id}`)
      .set('Authorization', `Bearer ${volunteerToken}`)
      .send(basePayload({ title: 'Actividad CP-24-07 editada' }))
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/volunteering/opportunities/${id}/close`)
      .set('Authorization', `Bearer ${volunteerToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/volunteering/opportunities/${id}/cancel`)
      .set('Authorization', `Bearer ${volunteerToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .get(`/volunteering/opportunities/${id}/applications`)
      .set('Authorization', `Bearer ${volunteerToken}`)
      .expect(403);
  });

  it('CP-24-08: otra organización no ve ni toca la oportunidad (aislamiento)', async () => {
    const id = await createOpportunity({ title: 'Actividad CP-24-08' });

    const list = await listAs(outsiderToken);
    expect(list.some((o) => o.id === id)).toBe(false);

    await request(app.getHttpServer())
      .post(`/volunteering/opportunities/${id}/applications`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(404);
  });

  it('CP-24-09: sin autenticación no se puede listar ni postularse', async () => {
    const id = await createOpportunity({ title: 'Actividad CP-24-09' });

    await request(app.getHttpServer())
      .get('/volunteering/opportunities')
      .expect(401);

    await request(app.getHttpServer())
      .post(`/volunteering/opportunities/${id}/applications`)
      .expect(401);
  });

  it('CP-24-10: cerrar o cancelar una actividad le impide seguir recibiendo postulaciones', async () => {
    const closed = await createOpportunity({ title: 'Actividad a cerrar' });
    await request(app.getHttpServer())
      .patch(`/volunteering/opportunities/${closed}/close`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/volunteering/opportunities/${closed}/applications`)
      .set('Authorization', `Bearer ${volunteerToken}`)
      .expect(409);

    const cancelled = await createOpportunity({
      title: 'Actividad a cancelar',
    });
    await request(app.getHttpServer())
      .patch(`/volunteering/opportunities/${cancelled}/cancel`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/volunteering/opportunities/${cancelled}/applications`)
      .set('Authorization', `Bearer ${volunteerToken}`)
      .expect(409);
  });

  it('CP-24-11: valida campos obligatorios e inválidos al crear una oportunidad', async () => {
    await request(app.getHttpServer())
      .post('/volunteering/opportunities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(400);

    await request(app.getHttpServer())
      .post('/volunteering/opportunities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(basePayload({ capacity: 0 }))
      .expect(400);

    await request(app.getHttpServer())
      .post('/volunteering/opportunities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(basePayload({ startsAt: 'fecha-invalida' }))
      .expect(400);
  });
});
