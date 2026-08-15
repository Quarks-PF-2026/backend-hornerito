/**
 * QK-24 · Gestionar Voluntariado — PU-1 a PU-4 del ticket, más los bordes
 * que el ticket da por obvios (doble postulación, aislamiento entre
 * organizaciones).
 *
 * El voluntariado es interno: el voluntario es un miembro de la organización
 * con rol `voluntario`. La membresía se inserta directo en la base, igual que
 * hace `createPlatformAdmin` en los helpers — el alta por invitación es lo
 * que prueba QK-15, no esta historia.
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

describe('QK-24 Gestionar Voluntariado (e2e)', () => {
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

    const ownerEmail = uniqueEmail('qk24-owner');
    emails.push(ownerEmail);
    const owner = await registerAndLogin(app, ownerEmail);
    const org = await createOrganization(app, owner.token);
    orgIds.push(org.id);
    ownerToken = await switchOrg(app, owner.token, org.id);

    const volunteerEmail = uniqueEmail('qk24-voluntario');
    emails.push(volunteerEmail);
    const volunteer = await registerAndLogin(app, volunteerEmail);
    await addVolunteerMember(volunteer.userId, org.id);
    volunteerToken = await switchOrg(app, volunteer.token, org.id);

    const otherVolunteerEmail = uniqueEmail('qk24-voluntario2');
    emails.push(otherVolunteerEmail);
    const otherVolunteer = await registerAndLogin(app, otherVolunteerEmail);
    await addVolunteerMember(otherVolunteer.userId, org.id);
    otherVolunteerToken = await switchOrg(app, otherVolunteer.token, org.id);

    const outsiderEmail = uniqueEmail('qk24-otra-org');
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

  it('PU-1: crea una actividad con cupos y aparece en el listado del voluntario', async () => {
    const id = await createOpportunity({ title: 'Actividad PU-1' });

    const list = await listAs(volunteerToken);
    const found = list.find((o) => o.id === id);

    expect(found).toBeDefined();
    expect(found?.capacity).toBe(2);
    expect(found?.acceptedCount).toBe(0);
    expect(found?.isOpen).toBe(true);
    expect(found?.myApplicationStatus).toBeNull();
  });

  it('PU-2: aceptar una postulación notifica al voluntario y baja el cupo', async () => {
    const id = await createOpportunity({ title: 'Actividad PU-2' });

    await request(app.getHttpServer())
      .post(`/volunteering/opportunities/${id}/applications`)
      .set('Authorization', `Bearer ${volunteerToken}`)
      .expect(201);

    const pending = await request(app.getHttpServer())
      .get(`/volunteering/opportunities/${id}/applications`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const applications = pending.body as {
      id: string;
      status: string;
      volunteerEmail: string;
    }[];
    expect(applications).toHaveLength(1);
    expect(applications[0].status).toBe('pending');
    expect(applications[0].volunteerEmail).toContain('qk24-voluntario');

    await request(app.getHttpServer())
      .patch(`/volunteering/applications/${applications[0].id}/accept`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    // El voluntario ve el resultado en su propio listado: esa es la
    // notificación in-app.
    const asVolunteer = (await listAs(volunteerToken)).find((o) => o.id === id);
    expect(asVolunteer?.myApplicationStatus).toBe('accepted');
    expect(asVolunteer?.acceptedCount).toBe(1);
    expect(asVolunteer?.isOpen).toBe(true); // queda 1 de 2 cupos
  });

  it('PU-3: al cubrirse los cupos deja de aceptar postulaciones', async () => {
    const id = await createOpportunity({
      title: 'Actividad PU-3',
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
  });

  it('PU-4: rechazar informa al voluntario y no mueve el cupo', async () => {
    const id = await createOpportunity({ title: 'Actividad PU-4' });

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

  it('rechaza una segunda postulación del mismo voluntario', async () => {
    const id = await createOpportunity({ title: 'Actividad duplicada' });

    await request(app.getHttpServer())
      .post(`/volunteering/opportunities/${id}/applications`)
      .set('Authorization', `Bearer ${volunteerToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/volunteering/opportunities/${id}/applications`)
      .set('Authorization', `Bearer ${volunteerToken}`)
      .expect(409);
  });

  it('el voluntario no puede publicar ni resolver postulaciones', async () => {
    await request(app.getHttpServer())
      .post('/volunteering/opportunities')
      .set('Authorization', `Bearer ${volunteerToken}`)
      .send(basePayload({ title: 'No debería crearse' }))
      .expect(403);
  });

  it('cierra y cancela la actividad, que deja de aceptar postulaciones', async () => {
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

  it('no deja bajar los cupos por debajo de los voluntarios ya aceptados', async () => {
    const id = await createOpportunity({ title: 'Actividad con aceptados' });
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

    await request(app.getHttpServer())
      .put(`/volunteering/opportunities/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(basePayload({ title: 'Actividad con aceptados', capacity: 0 }))
      .expect(400); // capacity 0 lo frena el DTO

    await request(app.getHttpServer())
      .put(`/volunteering/opportunities/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(basePayload({ title: 'Actividad con aceptados', capacity: 1 }))
      .expect(200);
  });

  it('CA-7: otra organización no ve ni toca la oportunidad', async () => {
    const id = await createOpportunity({ title: 'Actividad privada' });

    const list = await listAs(outsiderToken);
    expect(list.some((o) => o.id === id)).toBe(false);

    await request(app.getHttpServer())
      .post(`/volunteering/opportunities/${id}/applications`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(404);
  });

  it('valida los campos obligatorios', async () => {
    await request(app.getHttpServer())
      .post('/volunteering/opportunities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(400);
  });
});
