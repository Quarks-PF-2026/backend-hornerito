/**
 * QK-112 · Cargar la ubicación de la organización — CP-112-01 a CP-112-08
 * Casos tal como figuran en "DOC TESTEO BACK Sprint 5.pdf" (backend, capa API/DB).
 *
 * Contrato real verificado en `organization.controller.ts` /
 * `organization.service.ts` / `update-organization.dto.ts` /
 * `geocoding.controller.ts` / `geocoding.service.ts`:
 *   - `PUT /organization/me` solo detrás de `JwtAuthGuard` (sin TenantGuard:
 *     no depende de que la organización esté validada).
 *   - El trío locality/province/country viaja junto y `locality` es la
 *     llave: si no viene en el body, la ubicación guardada no se toca
 *     (`organization.service.ts#locationOf`). Si viene, los tres se
 *     reemplazan enteros (nunca se mezcla uno nuevo con otro viejo).
 *   - `GET /organization/me` devuelve un ARRAY de organizaciones del
 *     usuario (no un objeto): se toma `body[0]`.
 *   - `GeocodingService` sirve detrás de un proxy a Nominatim con `fetch`
 *     global; ante cualquier falla (red, timeout, !response.ok) devuelve
 *     `[]` sin excepción. Se mockea `global.fetch` para CP-112-04/07, nunca
 *     se pega contra Nominatim real.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  bootstrapApp,
  cleanupOrganizations,
  cleanupUsers,
  createOrganization,
  addMembership,
  messagesOf,
  registerAndLogin,
  uniqueEmail,
} from './helpers';

interface OrgBody {
  id: string;
  name: string;
  description: string;
  address: string;
  contact: string;
  locality: string | null;
  province: string | null;
  country: string | null;
  seeksVolunteers?: boolean;
}

const BASE_PROFILE = {
  name: 'Comedor Manos del Barrio',
  description: 'Brindamos almuerzo y merienda.',
  address: 'Bv. Sarmiento 1450',
  contact: '353 412-7788',
};

describe('QK-112 · Cargar la ubicación de la organización (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const emails: string[] = [];
  const orgIds: string[] = [];
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  function putProfile(token: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .put('/organization/me')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  async function myOrg(token: string): Promise<OrgBody> {
    const res = await request(app.getHttpServer())
      .get('/organization/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return (res.body as OrgBody[])[0];
  }

  async function newOwner(prefix: string, name?: string) {
    const email = uniqueEmail(prefix);
    emails.push(email);
    const owner = await registerAndLogin(app, email);
    const org = await createOrganization(app, owner.token, {
      name: name ?? 'Comedor Manos del Barrio',
    });
    orgIds.push(org.id);
    return { token: owner.token, userId: owner.userId, orgId: org.id };
  }

  beforeAll(async () => {
    ({ app, dataSource } = await bootstrapApp());
  });

  afterAll(async () => {
    await cleanupOrganizations(dataSource, orgIds);
    await cleanupUsers(dataSource, emails);
    await app.close();
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it('CP-112-01: guardar el perfil con una sugerencia elegida persiste el trío sin alterar el resto', async () => {
    const owner = await newOwner('cp112-01');

    const res = await putProfile(owner.token, {
      ...BASE_PROFILE,
      locality: 'Villa María',
      province: 'Córdoba',
      country: 'Argentina',
    }).expect(200);
    const body = res.body as OrgBody;
    expect(body.locality).toBe('Villa María');
    expect(body.province).toBe('Córdoba');
    expect(body.country).toBe('Argentina');

    const reread = await myOrg(owner.token);
    expect(reread.locality).toBe('Villa María');
    expect(reread.province).toBe('Córdoba');
    expect(reread.country).toBe('Argentina');
    expect(reread.address).toBe(BASE_PROFILE.address);
    expect(reread.name).toBe(BASE_PROFILE.name);
    expect(reread.description).toBe(BASE_PROFILE.description);
    expect(reread.contact).toBe(BASE_PROFILE.contact);
  });

  it('CP-112-02: la ubicación es opcional, no envía locality y queda sin localidad', async () => {
    const owner = await newOwner('cp112-02');

    const res = await putProfile(owner.token, BASE_PROFILE).expect(200);
    const body = res.body as OrgBody;
    expect(body.locality).toBeNull();
    expect(body.province).toBeNull();
    expect(body.country).toBeNull();

    const reread = await myOrg(owner.token);
    expect(reread.locality).toBeNull();

    // "organización preexistente que nunca editó su perfil": la creación
    // misma (vía createOrganization) tampoco mandó ubicación.
    const row = await dataSource.query(
      `SELECT locality, province, country FROM organizations WHERE id = $1`,
      [owner.orgId],
    );
    expect(row[0]).toEqual({ locality: null, province: null, country: null });
  });

  it('CP-112-03: reenviar el perfil sin ubicación no borra la ya guardada', async () => {
    const owner = await newOwner('cp112-03');
    await putProfile(owner.token, {
      ...BASE_PROFILE,
      locality: 'Villa María',
      province: 'Córdoba',
      country: 'Argentina',
    }).expect(200);

    const res = await putProfile(owner.token, {
      ...BASE_PROFILE,
      seeksVolunteers: true,
    }).expect(200);
    const body = res.body as OrgBody;
    expect(body.seeksVolunteers).toBe(true);
    expect(body.locality).toBe('Villa María');

    const reread = await myOrg(owner.token);
    expect(reread.seeksVolunteers).toBe(true);
    expect(reread.locality).toBe('Villa María');
    expect(reread.province).toBe('Córdoba');
    expect(reread.country).toBe('Argentina');
  });

  it('CP-112-04: si Nominatim no responde, la búsqueda devuelve [] y el perfil se guarda igual', async () => {
    const owner = await newOwner('cp112-04');

    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('network down'));

    const search = await request(app.getHttpServer())
      .get('/geocoding/search')
      .query({ q: 'Villa María' })
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(search.body).toEqual([]);

    const save = await putProfile(owner.token, BASE_PROFILE).expect(200);
    const body = save.body as OrgBody;
    expect(body.locality).toBeNull();
    expect(body.province).toBeNull();
    expect(body.country).toBeNull();
  });

  it('CP-112-05: cambiar una localidad ya cargada reemplaza el trío completo', async () => {
    const owner = await newOwner('cp112-05');
    await putProfile(owner.token, {
      ...BASE_PROFILE,
      locality: 'Villa María',
      province: 'Córdoba',
      country: 'Argentina',
    }).expect(200);

    await putProfile(owner.token, {
      ...BASE_PROFILE,
      locality: 'Rosario',
      province: 'Santa Fe',
      country: 'Argentina',
    }).expect(200);
    let reread = await myOrg(owner.token);
    expect(reread.locality).toBe('Rosario');
    expect(reread.province).toBe('Santa Fe');
    expect(reread.country).toBe('Argentina');

    await putProfile(owner.token, {
      ...BASE_PROFILE,
      locality: 'Río Cuarto',
    }).expect(200);
    reread = await myOrg(owner.token);
    expect(reread.locality).toBe('Río Cuarto');
    expect(reread.province).toBeNull();
    expect(reread.country).toBeNull();
  });

  it('CP-112-06: aislamiento — cada organización ve y modifica solo su ubicación; el coordinador no puede editar', async () => {
    const ownerA = await newOwner('cp112-06-a', 'Comedor A');
    await putProfile(ownerA.token, {
      ...BASE_PROFILE,
      locality: 'Villa María',
      province: 'Córdoba',
      country: 'Argentina',
    }).expect(200);

    const ownerB = await newOwner('cp112-06-b', 'Comedor B');
    await putProfile(ownerB.token, {
      ...BASE_PROFILE,
      locality: 'Río Cuarto',
      province: 'Córdoba',
      country: 'Argentina',
    }).expect(200);

    const coordEmail = uniqueEmail('cp112-06-coord');
    emails.push(coordEmail);
    const coord = await registerAndLogin(app, coordEmail);
    await addMembership(dataSource, coord.userId, ownerA.orgId, 'coordinador');

    const res = await putProfile(coord.token, {
      ...BASE_PROFILE,
      locality: 'Tío Pujio',
    }).expect(403);
    expect((res.body as { message: string }).message).toBe(
      'Solo el dueño puede editar los datos de la organización.',
    );

    const rereadA = await myOrg(ownerA.token);
    expect(rereadA.locality).toBe('Villa María');
    const rereadB = await myOrg(ownerB.token);
    expect(rereadB.locality).toBe('Río Cuarto');
  });

  it('CP-112-07: el geocodificador normaliza localidad/provincia/país y exige sesión y texto mínimo', async () => {
    const owner = await newOwner('cp112-07');

    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [
        {
          display_name: 'Villa María, Córdoba, Argentina',
          lat: '-32.4075',
          lon: '-63.2402',
          address: {
            town: 'Villa María',
            state: 'Córdoba',
            country: 'Argentina',
          },
        },
      ],
    } as Response);

    const found = await request(app.getHttpServer())
      .get('/geocoding/search')
      .query({ q: 'Villa' })
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    const [suggestion] = found.body as Array<{
      label: string;
      lat: number;
      lon: number;
      locality: string;
      province: string;
      country: string;
    }>;
    expect(suggestion).toEqual(
      expect.objectContaining({
        label: expect.any(String),
        lat: expect.any(Number),
        lon: expect.any(Number),
        locality: 'Villa María',
        province: 'Córdoba',
        country: 'Argentina',
      }),
    );

    fetchSpy.mockClear();
    const short = await request(app.getHttpServer())
      .get('/geocoding/search')
      .query({ q: 'Vi' })
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(short.body).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .get('/geocoding/search')
      .query({ q: 'Villa' })
      .expect(401);
  });

  it('CP-112-08: valida la longitud de locality/province/country en el DTO del perfil', async () => {
    const owner = await newOwner('cp112-08');
    const long = 'x'.repeat(121);

    const byLocality = await putProfile(owner.token, {
      ...BASE_PROFILE,
      locality: long,
    }).expect(400);
    expect(messagesOf(byLocality.body)).toContain(
      'La localidad no puede superar los 120 caracteres.',
    );

    const byProvince = await putProfile(owner.token, {
      ...BASE_PROFILE,
      locality: 'Villa María',
      province: long,
    }).expect(400);
    expect(messagesOf(byProvince.body)).toContain(
      'La provincia no puede superar los 120 caracteres.',
    );

    const byCountry = await putProfile(owner.token, {
      ...BASE_PROFILE,
      locality: 'Villa María',
      province: 'Córdoba',
      country: long,
    }).expect(400);
    expect(messagesOf(byCountry.body)).toContain(
      'El país no puede superar los 120 caracteres.',
    );

    const reread = await myOrg(owner.token);
    expect(reread.locality).toBeNull();
  });
});
