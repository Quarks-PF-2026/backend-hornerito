/**
 * QK-15 · Administrar Usuarios — CP-15-01 a CP-15-06
 * Casos tal como figuran en "Documentación del sprint 2 - Equipo 14.pdf".
 *
 * Nota de trazabilidad importante: lo implementado (`/organization/members`)
 * es gestión de miembros DENTRO de una organización (dueño/admin sobre su
 * propio equipo), no un panel de administración global de "usuarios de la
 * plataforma" como describe el PDF. Consecuencias concretas para estos
 * casos:
 *  - `GET /organization/members` no acepta ningún filtro de búsqueda (el
 *    controller no declara `@Query()`): siempre devuelve TODOS los
 *    miembros de la organización. CP-15-01 y CP-15-06 asumen que el backend
 *    filtra por el criterio recibido; se prueba tal cual lo describe el PDF
 *    y por eso fallan contra el comportamiento real.
 *  - Deshabilitar a un miembro (`toggle`) le revoca el acceso a ESA
 *    organización, pero no bloquea su login a la plataforma (el usuario
 *    sigue pudiendo autenticarse, solo queda sin organización activa).
 *    CP-15-02 espera que el login sea rechazado; en el sistema real no lo
 *    es, así que el test también documenta ese desvío.
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
  DEFAULT_PASSWORD,
} from './helpers';

interface Member {
  userId: string;
  email: string;
  role: string;
  active: boolean;
}

async function inviteAndAccept(
  app: INestApplication,
  dataSource: DataSource,
  ownerToken: string,
  orgId: string,
  email: string,
  role: string,
): Promise<{ token: string; userId: string }> {
  await request(app.getHttpServer())
    .post('/organization/members/invitations')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ email, role })
    .expect(201);

  const rows: Array<{ token: string }> = await dataSource.query(
    `SELECT token FROM organization_invitations
     WHERE email = $1 AND "organizationId" = $2
     ORDER BY "createdAt" DESC LIMIT 1`,
    [email, orgId],
  );
  const invitationToken = rows[0].token;

  const res = await request(app.getHttpServer())
    .post(`/invitations/${invitationToken}/accept`)
    .send({ name: 'Miembro de prueba', password: DEFAULT_PASSWORD })
    .expect(201);

  const body = res.body as { accessToken: string; user: { id: string } };
  return { token: body.accessToken, userId: body.user.id };
}

describe('QK-15 Administrar Usuarios (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ownerToken: string;
  let orgId: string;
  let memberEmail: string;
  let memberUserId: string;
  let memberToken: string;
  const orgIds: string[] = [];
  const emails: string[] = [];

  beforeAll(async () => {
    ({ app, dataSource } = await bootstrapApp());

    const ownerEmail = uniqueEmail('qk15-owner');
    emails.push(ownerEmail);
    const ownerSession = await registerAndLogin(app, ownerEmail);
    const org = await createOrganization(app, ownerSession.token);
    orgId = org.id;
    orgIds.push(orgId);
    ownerToken = await switchOrg(app, ownerSession.token, orgId);

    memberEmail = uniqueEmail('qk15-member');
    emails.push(memberEmail);
    const member = await inviteAndAccept(
      app,
      dataSource,
      ownerToken,
      orgId,
      memberEmail,
      'voluntario',
    );
    memberUserId = member.userId;
    memberToken = member.token;
  });

  afterAll(async () => {
    await cleanupOrganizations(dataSource, orgIds);
    await cleanupUsers(dataSource, emails);
    await app.close();
  });

  it('CP-15-01: busca un usuario por correo y obtiene solo las coincidencias', async () => {
    const res = await request(app.getHttpServer())
      .get('/organization/members')
      .query({ search: memberEmail })
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const members = res.body as Member[];
    // El PDF espera SOLO el/los usuario(s) que matchean el criterio.
    expect(members).toHaveLength(1);
    expect(members[0].email).toBe(memberEmail);
  });

  it('CP-15-02: deshabilita un usuario y el login con esa cuenta es rechazado', async () => {
    await request(app.getHttpServer())
      .patch(`/organization/members/${memberUserId}/toggle`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: memberEmail, password: DEFAULT_PASSWORD })
      .expect(401);
  });

  it('CP-15-03: rehabilita un usuario deshabilitado y recupera el acceso', async () => {
    // Vuelve a activarlo (venía desactivado por CP-15-02).
    const toggled = await request(app.getHttpServer())
      .patch(`/organization/members/${memberUserId}/toggle`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect((toggled.body as Member).active).toBe(true);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: memberEmail, password: DEFAULT_PASSWORD })
      .expect(200);

    expect((login.body as { role: string }).role).toBe('voluntario');
  });

  it('CP-15-04: modifica el rol y los permisos se actualizan al ingresar', async () => {
    await request(app.getHttpServer())
      .patch(`/organization/members/${memberUserId}/role`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ role: 'admin' })
      .expect(200);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: memberEmail, password: DEFAULT_PASSWORD })
      .expect(200);
    const body = login.body as { role: string; accessToken: string };
    expect(body.role).toBe('admin');

    // Con el rol nuevo (admin) ya puede entrar a administración de miembros.
    await request(app.getHttpServer())
      .get('/organization/members')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);

    memberToken = body.accessToken;
  });

  it('CP-15-05: un usuario sin rol de administrador no accede a la sección', async () => {
    const volunteerEmail = uniqueEmail('qk15-volunteer');
    emails.push(volunteerEmail);
    const volunteer = await inviteAndAccept(
      app,
      dataSource,
      ownerToken,
      orgId,
      volunteerEmail,
      'voluntario',
    );

    await request(app.getHttpServer())
      .get('/organization/members')
      .set('Authorization', `Bearer ${volunteer.token}`)
      .expect(403);
  });

  it('CP-15-06: la búsqueda sin coincidencias devuelve un listado vacío', async () => {
    const res = await request(app.getHttpServer())
      .get('/organization/members')
      .query({ search: 'usuario_inexistente@test.com' })
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(res.body as Member[]).toHaveLength(0);
  });
});
