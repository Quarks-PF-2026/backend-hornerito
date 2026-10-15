/**
 * QK-33 · Administrar Tipo de Voluntario — trazabilidad CP-33-01 a CP-33-10
 *
 * Suite NUEVA de trazabilidad QA (IDs del plan de pruebas), aparte de
 * `test/sprint3/qk-33-volunteer-types.e2e-spec.ts` (regresión real del
 * equipo). No se toca ese archivo.
 *
 * Contrato real verificado en `volunteer-type.controller.ts` /
 * `volunteer-type.service.ts`:
 *   - `GET /volunteer-types` sin `@Roles` (cualquier miembro activo);
 *   - `POST /volunteer-types`, `PUT /volunteer-types/:id`,
 *     `PATCH /volunteer-types/:id/toggle` con CONTENT_WRITER_ROLES;
 *   - el catálogo nace sembrado con `DEFAULT_VOLUNTEER_TYPES` al crear la
 *     organización;
 *   - no hay borrado físico: "dar de baja" es el toggle a `active:false`.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { DEFAULT_VOLUNTEER_TYPES } from '../src/modules/volunteer-type/entities/volunteer-type.entity';
import {
  bootstrapApp,
  cleanupOrganizations,
  cleanupUsers,
  createOrganization,
  registerAndLogin,
  switchOrg,
  uniqueEmail,
} from './sprint2/helpers';

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

describe('QK-33 · Administrar Tipo de Voluntario — trazabilidad CP-33 (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ownerToken: string;
  let volunteerToken: string;
  let outsiderToken: string;
  /** Tipo del catálogo de la OTRA organización, para el aislamiento. */
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

    const ownerEmail = uniqueEmail('qk33cp-owner');
    emails.push(ownerEmail);
    const owner = await registerAndLogin(app, ownerEmail);
    const org = await createOrganization(app, owner.token);
    orgIds.push(org.id);
    ownerToken = await switchOrg(app, owner.token, org.id);

    const volunteerEmail = uniqueEmail('qk33cp-voluntario');
    emails.push(volunteerEmail);
    const volunteer = await registerAndLogin(app, volunteerEmail);
    await dataSource.query(
      `INSERT INTO organization_memberships ("userId", "organizationId", role, active)
       VALUES ($1, $2, 'voluntario', true)`,
      [volunteer.userId, org.id],
    );
    volunteerToken = await switchOrg(app, volunteer.token, org.id);

    const outsiderEmail = uniqueEmail('qk33cp-otra-org');
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

  it('CP-33-01: el catálogo nace sembrado con los tipos por defecto al crear la organización', async () => {
    const types = await listTypes(ownerToken);
    expect(types.map((t) => t.name).sort()).toEqual(
      [...DEFAULT_VOLUNTEER_TYPES].sort(),
    );
    expect(types.every((t) => t.active)).toBe(true);
  });

  it('CP-33-02: crea un tipo nuevo, activo por defecto', async () => {
    const created = await request(app.getHttpServer())
      .post('/volunteer-types')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Huerta' })
      .expect(201);
    expect((created.body as TypeBody).active).toBe(true);
    expect((created.body as TypeBody).name).toBe('Huerta');
  });

  it('CP-33-03: renombra un tipo existente', async () => {
    // "Traducción" y no un nombre del catálogo por defecto (`Cocina`,
    // `Reparto`, `Logística`, `Limpieza`, `Apoyo escolar`, ver
    // `DEFAULT_VOLUNTEER_TYPES`): colisionaría con el sembrado y daría 409.
    const created = await request(app.getHttpServer())
      .post('/volunteer-types')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Traducción' })
      .expect(201);
    const id = (created.body as TypeBody).id;

    const updated = await request(app.getHttpServer())
      .put(`/volunteer-types/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Traducción e interpretación' })
      .expect(200);
    expect((updated.body as TypeBody).name).toBe('Traducción e interpretación');
  });

  it('CP-33-04: da de baja un tipo (baja lógica); sigue en el listado, apagado', async () => {
    const created = await request(app.getHttpServer())
      .post('/volunteer-types')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Difusión' })
      .expect(201);
    const id = (created.body as TypeBody).id;

    const toggled = await request(app.getHttpServer())
      .patch(`/volunteer-types/${id}/toggle`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect((toggled.body as TypeBody).active).toBe(false);

    const types = await listTypes(ownerToken);
    const found = types.find((t) => t.id === id);
    expect(found).toBeDefined();
    expect(found?.active).toBe(false);
  });

  it('CP-33-05: una oportunidad ya creada con un tipo dado de baja conserva la referencia', async () => {
    const created = await request(app.getHttpServer())
      .post('/volunteer-types')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Eventos' })
      .expect(201);
    const typeId = (created.body as TypeBody).id;

    const opportunity = await request(app.getHttpServer())
      .post('/volunteering/opportunities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(opportunityPayload({ volunteerTypeId: typeId }))
      .expect(201);
    const opportunityId = (opportunity.body as { id: string }).id;

    await request(app.getHttpServer())
      .patch(`/volunteer-types/${typeId}/toggle`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const listed = await request(app.getHttpServer())
      .get('/volunteering/opportunities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const found = (
      listed.body as { id: string; volunteerTypeId: string | null }[]
    ).find((o) => o.id === opportunityId);
    // La baja del tipo no borra ni desvincula la clasificación ya asignada.
    expect(found?.volunteerTypeId).toBe(typeId);
  });

  it('CP-33-06: rechaza un nombre repetido, sin importar mayúsculas (409)', async () => {
    await request(app.getHttpServer())
      .post('/volunteer-types')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'cocina' })
      .expect(409);
  });

  it('CP-33-07: rechaza un nombre vacío o demasiado corto', async () => {
    await request(app.getHttpServer())
      .post('/volunteer-types')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: '' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/volunteer-types')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'A' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/volunteer-types')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(400);
  });

  it('CP-33-08: un voluntario lee el catálogo pero no puede crear ni editar tipos', async () => {
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

  it('CP-33-09: cada organización ve y edita solo su propio catálogo (aislamiento)', async () => {
    const mine = await listTypes(ownerToken);
    const theirs = await listTypes(outsiderToken);

    expect(mine.some((t) => t.id === outsiderTypeId)).toBe(false);
    expect(theirs.some((t) => t.id === outsiderTypeId)).toBe(true);

    await request(app.getHttpServer())
      .put(`/volunteer-types/${outsiderTypeId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Ajeno' })
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/volunteer-types/${outsiderTypeId}/toggle`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);
  });

  it('CP-33-10: sin autenticación no se puede leer ni administrar el catálogo', async () => {
    await request(app.getHttpServer()).get('/volunteer-types').expect(401);

    await request(app.getHttpServer())
      .post('/volunteer-types')
      .send({ name: 'Sin sesión' })
      .expect(401);
  });
});
