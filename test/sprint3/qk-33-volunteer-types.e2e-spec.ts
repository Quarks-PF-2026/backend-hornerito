/**
 * QK-33 · Administrar Tipo de Voluntario — el catálogo por organización y su
 * uso desde una oportunidad de voluntariado.
 *
 * El catálogo nace sembrado (DEFAULT_VOLUNTEER_TYPES) al crear la
 * organización, así que el formulario de una actividad nunca arranca con el
 * select vacío.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { DEFAULT_VOLUNTEER_TYPES } from '../../src/modules/volunteer-type/entities/volunteer-type.entity';
import {
  bootstrapApp,
  cleanupOrganizations,
  cleanupUsers,
  createOrganization,
  registerAndLogin,
  switchOrg,
  uniqueEmail,
} from '../sprint2/helpers';

interface TypeBody {
  id: string;
  name: string;
  active: boolean;
}

function opportunityPayload(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Merienda del sábado',
    description: 'Servimos la merienda a 80 chicos del barrio.',
    startsAt: '2026-09-12T17:00:00.000Z',
    location: 'Bv. Sarmiento 1450, Villa María',
    capacity: 2,
    ...overrides,
  };
}

describe('QK-33 Administrar Tipo de Voluntario (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ownerToken: string;
  let volunteerToken: string;
  let outsiderToken: string;
  /** Tipo del catálogo de la OTRA organización, para probar el aislamiento. */
  let outsiderTypeId: string;
  const orgIds: string[] = [];
  const emails: string[] = [];

  async function listTypes(token: string): Promise<TypeBody[]> {
    const res = await request(app.getHttpServer())
      .get('/volunteer-types')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body as TypeBody[];
  }

  beforeAll(async () => {
    ({ app, dataSource } = await bootstrapApp());

    const ownerEmail = uniqueEmail('qk33-owner');
    emails.push(ownerEmail);
    const owner = await registerAndLogin(app, ownerEmail);
    const org = await createOrganization(app, owner.token);
    orgIds.push(org.id);
    ownerToken = await switchOrg(app, owner.token, org.id);

    const volunteerEmail = uniqueEmail('qk33-voluntario');
    emails.push(volunteerEmail);
    const volunteer = await registerAndLogin(app, volunteerEmail);
    await dataSource.query(
      `INSERT INTO organization_memberships ("userId", "organizationId", role, active)
       VALUES ($1, $2, 'voluntario', true)`,
      [volunteer.userId, org.id],
    );
    volunteerToken = await switchOrg(app, volunteer.token, org.id);

    const outsiderEmail = uniqueEmail('qk33-otra-org');
    emails.push(outsiderEmail);
    const outsider = await registerAndLogin(app, outsiderEmail);
    const otherOrg = await createOrganization(app, outsider.token, {
      name: 'Comedor de otra ciudad',
    });
    orgIds.push(otherOrg.id);
    outsiderToken = await switchOrg(app, outsider.token, otherOrg.id);
    outsiderTypeId = (await listTypes(outsiderToken))[0].id;
  });

  afterAll(async () => {
    await cleanupOrganizations(dataSource, orgIds);
    await cleanupUsers(dataSource, emails);
    await app.close();
  });

  it('siembra el catálogo por defecto al crear la organización', async () => {
    const types = await listTypes(ownerToken);

    expect(types.map((t) => t.name).sort()).toEqual(
      [...DEFAULT_VOLUNTEER_TYPES].sort(),
    );
    expect(types.every((t) => t.active)).toBe(true);
  });

  it('crea, renombra y da de baja un tipo', async () => {
    const created = await request(app.getHttpServer())
      .post('/volunteer-types')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Huerta' })
      .expect(201);
    const id = (created.body as TypeBody).id;
    expect((created.body as TypeBody).active).toBe(true);

    await request(app.getHttpServer())
      .put(`/volunteer-types/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Huerta comunitaria' })
      .expect(200)
      .expect(({ body }) =>
        expect((body as TypeBody).name).toBe('Huerta comunitaria'),
      );

    // Baja lógica: sigue en el listado, apagado.
    await request(app.getHttpServer())
      .patch(`/volunteer-types/${id}/toggle`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200)
      .expect(({ body }) => expect((body as TypeBody).active).toBe(false));

    const types = await listTypes(ownerToken);
    expect(types.find((t) => t.id === id)?.active).toBe(false);
  });

  it('rechaza un nombre repetido sin importar mayúsculas', async () => {
    await request(app.getHttpServer())
      .post('/volunteer-types')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'cocina' })
      .expect(409);
  });

  it('el voluntario lee el catálogo pero no lo edita', async () => {
    await request(app.getHttpServer())
      .get('/volunteer-types')
      .set('Authorization', `Bearer ${volunteerToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post('/volunteer-types')
      .set('Authorization', `Bearer ${volunteerToken}`)
      .send({ name: 'Prohibido' })
      .expect(403);
  });

  it('cada organización ve solo su catálogo', async () => {
    const mine = await listTypes(ownerToken);
    const theirs = await listTypes(outsiderToken);

    expect(mine.some((t) => t.id === outsiderTypeId)).toBe(false);
    expect(theirs.some((t) => t.id === outsiderTypeId)).toBe(true);

    await request(app.getHttpServer())
      .put(`/volunteer-types/${outsiderTypeId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Ajeno' })
      .expect(404);
  });

  it('clasifica una oportunidad con un tipo del catálogo propio', async () => {
    const [type] = await listTypes(ownerToken);

    const created = await request(app.getHttpServer())
      .post('/volunteering/opportunities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(opportunityPayload({ volunteerTypeId: type.id }))
      .expect(201);
    const id = (created.body as { id: string }).id;

    const listed = await request(app.getHttpServer())
      .get('/volunteering/opportunities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const found = (
      listed.body as { id: string; volunteerTypeId: string }[]
    ).find((o) => o.id === id);
    expect(found?.volunteerTypeId).toBe(type.id);

    // Quitar la clasificación es válido: el campo es opcional.
    await request(app.getHttpServer())
      .put(`/volunteering/opportunities/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(opportunityPayload({ volunteerTypeId: null }))
      .expect(200)
      .expect(({ body }) =>
        expect(
          (body as { volunteerTypeId: string | null }).volunteerTypeId,
        ).toBeNull(),
      );
  });

  it('no acepta el tipo de otra organización', async () => {
    await request(app.getHttpServer())
      .post('/volunteering/opportunities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(opportunityPayload({ volunteerTypeId: outsiderTypeId }))
      .expect(404);
  });
});
