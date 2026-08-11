/**
 * QK-13 · Administrar Organización — CP-13-01 a CP-13-06
 * Casos tal como figuran en "Documentación del sprint 2 - Equipo 14.pdf".
 *
 * Toda organización nueva nace `pending` (default de la entidad); pasa a
 * `validated`/`rejected` vía `/admin/organizations/:id/(validate|reject)`,
 * accesible solo a un platform admin (`User.isPlatformAdmin`, ver
 * `PlatformAdminGuard`) — un rol de plataforma aparte de los roles de
 * organización, porque validar la propia organización no tendría sentido.
 * Los tests usan `createPlatformAdmin()` para representar a ese actor.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  bootstrapApp,
  cleanupOrganizations,
  cleanupUsers,
  createPlatformAdmin,
  registerAndLogin,
  switchOrg,
  uniqueEmail,
} from './helpers';

// PNG válido (magic bytes reales) para CP-13-06b, que queda en `it.skip`
// porque requiere credenciales de Cloudinary ausentes en este entorno.
const PDF_BYTES = Buffer.from('%PDF-1.4 not-an-image');

describe('QK-13 Administrar Organización (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const orgIds: string[] = [];
  const emails: string[] = [];

  beforeAll(async () => {
    ({ app, dataSource } = await bootstrapApp());
  });

  afterAll(async () => {
    await cleanupOrganizations(dataSource, orgIds);
    await cleanupUsers(dataSource, emails);
    await app.close();
  });

  it('CP-13-01: carga la organización y queda en estado "pendiente de validación"', async () => {
    const email = uniqueEmail('qk13-01');
    emails.push(email);
    const session = await registerAndLogin(app, email);

    const res = await request(app.getHttpServer())
      .put('/organization/me')
      .set('Authorization', `Bearer ${session.token}`)
      .send({
        name: 'Comedor Manos del Barrio',
        description: 'Brindamos almuerzo y merienda a más de 80 chicos.',
        address: 'Bv. Sarmiento 1450, Villa María, Córdoba',
        contact: '353 412-7788 / comedormanosdelbarrio@gmail.com',
      })
      .expect(200);

    const org = res.body as { id: string; status: string };
    orgIds.push(org.id);

    // Según el PDF, el estado esperado tras crear es "pending".
    expect(org.status).toBe('pending');
  });

  it('CP-13-02: la edición de datos se refleja en el perfil público', async () => {
    const email = uniqueEmail('qk13-02');
    emails.push(email);
    const session = await registerAndLogin(app, email);

    const created = await request(app.getHttpServer())
      .put('/organization/me')
      .set('Authorization', `Bearer ${session.token}`)
      .send({
        name: 'Comedor Manos del Barrio',
        description: 'Brindamos almuerzo y merienda.',
        address: 'Bv. Sarmiento 1450, Villa María, Córdoba',
        contact: '353 412-7788',
      })
      .expect(200);
    const orgId = (created.body as { id: string }).id;
    orgIds.push(orgId);

    // Precondición del caso: "Existe una organización cargada y validada".
    const admin = await createPlatformAdmin(app, uniqueEmail('qk13-02-admin'));
    emails.push(admin.email);
    await request(app.getHttpServer())
      .patch(`/admin/organizations/${orgId}/validate`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);

    const nuevaDescripcion =
      'Brindamos almuerzo, merienda y apoyo escolar de lunes a viernes.';
    await request(app.getHttpServer())
      .put('/organization/me')
      .set('Authorization', `Bearer ${session.token}`)
      .send({
        name: 'Comedor Manos del Barrio',
        description: nuevaDescripcion,
        address: 'Bv. Sarmiento 1450, Villa María, Córdoba',
        contact: '353 412-7788',
      })
      .expect(200);

    const publicView = await request(app.getHttpServer())
      .get(`/public/organizations/${orgId}`)
      .expect(200);

    expect((publicView.body as { description: string }).description).toBe(
      nuevaDescripcion,
    );
  });

  it('CP-13-03: no guarda la organización si falta la dirección obligatoria', async () => {
    const email = uniqueEmail('qk13-03');
    emails.push(email);
    const session = await registerAndLogin(app, email);

    await request(app.getHttpServer())
      .put('/organization/me')
      .set('Authorization', `Bearer ${session.token}`)
      .send({
        name: 'Comedor Manos del Barrio',
        description: 'Brindamos almuerzo y merienda.',
        address: '',
        contact: '353 412-7788',
      })
      .expect(400);
  });

  it('CP-13-04: el referente consulta el estado "Validada" tras la validación de un admin', async () => {
    const email = uniqueEmail('qk13-04');
    emails.push(email);
    const session = await registerAndLogin(app, email);

    const created = await request(app.getHttpServer())
      .put('/organization/me')
      .set('Authorization', `Bearer ${session.token}`)
      .send({
        name: 'Comedor Manos del Barrio',
        description: 'desc',
        address: 'Bv. Sarmiento 1450',
        contact: '353 412-7788',
      })
      .expect(200);
    const orgId = (created.body as { id: string }).id;
    orgIds.push(orgId);

    // El referente no puede validar su propia organización: hace falta un
    // platform admin, un actor distinto (ver PlatformAdminGuard).
    const admin = await createPlatformAdmin(app, uniqueEmail('qk13-04-admin'));
    emails.push(admin.email);
    await request(app.getHttpServer())
      .patch(`/admin/organizations/${orgId}/validate`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);

    // Un referente sin rol de admin no puede validar (sí lo intenta, para
    // dejar cubierta también esa autorización).
    await request(app.getHttpServer())
      .patch(`/admin/organizations/${orgId}/validate`)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(403);

    const mine = await request(app.getHttpServer())
      .get('/organization/me')
      .set('Authorization', `Bearer ${session.token}`)
      .expect(200);
    const own = (mine.body as Array<{ id: string; status: string }>).find(
      (o) => o.id === orgId,
    );
    expect(own?.status).toBe('validated');
  });

  it('CP-13-05: ante una organización rechazada, muestra estado y motivo', async () => {
    const email = uniqueEmail('qk13-05');
    emails.push(email);
    const session = await registerAndLogin(app, email);

    const created = await request(app.getHttpServer())
      .put('/organization/me')
      .set('Authorization', `Bearer ${session.token}`)
      .send({
        name: 'Comedor Manos del Barrio',
        description: 'desc',
        address: 'Bv. Sarmiento 1450',
        contact: '353 412-7788',
      })
      .expect(200);
    const orgId = (created.body as { id: string }).id;
    orgIds.push(orgId);

    const admin = await createPlatformAdmin(app, uniqueEmail('qk13-05-admin'));
    emails.push(admin.email);
    const reason = 'Los datos de contacto no pudieron ser verificados.';
    await request(app.getHttpServer())
      .patch(`/admin/organizations/${orgId}/reject`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ reason })
      .expect(200);

    const mine = await request(app.getHttpServer())
      .get('/organization/me')
      .set('Authorization', `Bearer ${session.token}`)
      .expect(200);
    const own = (
      mine.body as Array<{ id: string; status: string; rejectReason: string | null }>
    ).find((o) => o.id === orgId);
    expect(own?.status).toBe('rejected');
    expect(own?.rejectReason).toBe(reason);

    // No aparece en el directorio público mientras esté rechazada.
    await request(app.getHttpServer())
      .get(`/public/organizations/${orgId}`)
      .expect(404);
  });

  it('CP-13-06a: rechaza un logo con formato de archivo no permitido', async () => {
    const email = uniqueEmail('qk13-06a');
    emails.push(email);
    const session = await registerAndLogin(app, email);

    const created = await request(app.getHttpServer())
      .put('/organization/me')
      .set('Authorization', `Bearer ${session.token}`)
      .send({
        name: 'Comedor Manos del Barrio',
        description: 'desc',
        address: 'Bv. Sarmiento 1450',
        contact: '353 412-7788',
      })
      .expect(200);
    const orgId = (created.body as { id: string }).id;
    orgIds.push(orgId);

    // El endpoint de media pasa por TenantGuard, que exige la organización
    // validada (ver CP-12-01: "La organización está registrada y validada"
    // es precondición para operar sobre ella).
    const admin = await createPlatformAdmin(app, uniqueEmail('qk13-06-admin'));
    emails.push(admin.email);
    await request(app.getHttpServer())
      .patch(`/admin/organizations/${orgId}/validate`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);

    // El endpoint de media exige TenantGuard: el token tiene que traer
    // orgId, por eso hace falta escalarlo con switch-org primero.
    const orgToken = await switchOrg(app, session.token, orgId);

    await request(app.getHttpServer())
      .post(`/media/organization/${orgId}/logo`)
      .set('Authorization', `Bearer ${orgToken}`)
      .attach('file', PDF_BYTES, { filename: 'documento.pdf' })
      .expect(400);
  });

  // No verificable en este entorno: requiere credenciales reales de
  // Cloudinary (CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET), ausentes en la
  // configuración de test. `MediaService.uploadFor` valida el mime type
  // correctamente ANTES de llamar a Cloudinary (ver CP-13-06a, que sí pasa),
  // pero la subida en sí no se puede completar sin esas credenciales.
  it.skip('CP-13-06b: acepta y muestra un logo válido (requiere credenciales Cloudinary)', () => {});
});