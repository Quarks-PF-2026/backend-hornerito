/**
 * QK-16 · Validar Voluntario — trazabilidad CP-16-01 a CP-16-05
 *
 * **Esta historia DIVERGE POR COMPLETO del PDF del plan de pruebas.** El PDF
 * asume un autoregistro (`POST /volunteers`, autenticado por el propio
 * usuario). Ese endpoint NO EXISTE. Confirmado leyendo el código real:
 * `public-volunteer-request.controller.ts`, `volunteer-request.service.ts`,
 * `create-volunteer-request.dto.ts` y el panel en `VolunteeringController`.
 *
 * El flujo real es "Solicitud de Voluntario", con aprobación de un gestor:
 *
 *   1. Alta pública, **SIN AUTENTICACIÓN, y es intencional** (comentario del
 *      propio código: "Alta anónima... sin @UseGuards", riesgo de spam
 *      aceptado por el equipo, ver `PROYECTO.md`):
 *      `POST /public/organizations/:organizationId/volunteer-requests` →
 *      `{ name, email, phone?, message?, opportunityId?, volunteerTypeId? }`,
 *      con `opportunityId` y `volunteerTypeId` EXCLUYENTES entre sí. Nace
 *      `pending`. Devuelve `{ id, status }`.
 *   2. Panel de gestión (`CONTENT_WRITER_ROLES`, en `VolunteeringController`):
 *      `GET /volunteering/requests`, `PATCH /volunteering/requests/:id/approve`
 *      (reserva cupo si es sobre una actividad, y siempre crea una invitación
 *      por email con rol `voluntario` vía `MemberService.invite`),
 *      `PATCH /volunteering/requests/:id/reject` (body `{ reason }`).
 *   3. "Queda habilitado para postularse" (CP-16-01) es un flujo de varios
 *      pasos: aprobar → nace una invitación → alguien la acepta (mismo flujo
 *      de `organization_invitations` + `POST /invitations/:token/accept` que
 *      usa `test/sprint2/qk-26-donation.e2e-spec.ts`) → ya es miembro
 *      `voluntario` → recién ahí puede postularse a una oportunidad.
 *
 * Reinterpretación de los 5 CP del PDF:
 *   - CP-16-01: se prueba el flujo largo completo, sin acortar.
 *   - CP-16-02: 400 por campos obligatorios faltantes.
 *   - CP-16-03: el PDF asume que "ya es voluntario" se detecta al dar de
 *     alta. El código real NO valida eso en `submit()` — se comprueba
 *     empíricamente qué pasa (ver el test).
 *   - CP-16-04: 400 por formato inválido (email, teléfono).
 *   - CP-16-05 (adaptado): el PDF pide 401 sin autenticación — es lo
 *     OPUESTO de lo que hace el código a propósito. Se verifica el 201 real,
 *     no un 401 inexistente. Divergencia documentada, no un test fallido.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  DEFAULT_PASSWORD,
  bootstrapApp,
  cleanupOrganizations,
  cleanupUsers,
  createOrganization,
  registerAndLogin,
  switchOrg,
  uniqueEmail,
} from './sprint2/helpers';

interface RequestBody {
  id: string;
  status: string;
}

describe('QK-16 · Validar Voluntario — trazabilidad CP-16 (e2e, flujo real reinterpretado)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ownerToken: string;
  let orgId: string;
  const orgIds: string[] = [];
  const emails: string[] = [];

  function submit(body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`/public/organizations/${orgId}/volunteer-requests`)
      .send(body);
  }

  async function latestInvitationToken(email: string): Promise<string> {
    const rows: Array<{ token: string }> = await dataSource.query(
      `SELECT token FROM organization_invitations
       WHERE email = $1 AND "organizationId" = $2
       ORDER BY "createdAt" DESC LIMIT 1`,
      [email, orgId],
    );
    return rows[0].token;
  }

  beforeAll(async () => {
    ({ app, dataSource } = await bootstrapApp());

    const ownerEmail = uniqueEmail('qk16cp-owner');
    emails.push(ownerEmail);
    const owner = await registerAndLogin(app, ownerEmail);
    const org = await createOrganization(app, owner.token);
    orgId = org.id;
    orgIds.push(orgId);
    ownerToken = await switchOrg(app, owner.token, orgId);
  });

  afterAll(async () => {
    await cleanupOrganizations(dataSource, orgIds);
    await cleanupUsers(dataSource, emails);
    await app.close();
  });

  it('CP-16-01: solicitud pública → aprobación → aceptación de la invitación → el nuevo miembro se postula con éxito', async () => {
    const candidateEmail = uniqueEmail('qk16cp-candidato');
    emails.push(candidateEmail);

    // 1. Alta pública, sin sesión.
    const submitted = await submit({
      name: 'Laura Torres',
      email: candidateEmail,
      phone: '3534123456',
      message: 'Quiero ayudar los fines de semana.',
    }).expect(201);
    const requestBody = submitted.body as RequestBody;
    expect(requestBody.status).toBe('pending');

    // 2. El owner aprueba: nace una invitación con rol voluntario.
    const approved = await request(app.getHttpServer())
      .patch(`/volunteering/requests/${requestBody.id}/approve`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect((approved.body as { status: string }).status).toBe('approved');

    // 3. El candidato acepta la invitación desde el correo (token en la base:
    // en producción viaja por mail, acá no hay bandeja que consultar).
    const token = await latestInvitationToken(candidateEmail);
    const accepted = await request(app.getHttpServer())
      .post(`/invitations/${token}/accept`)
      .send({ name: 'Laura Torres', password: DEFAULT_PASSWORD })
      .expect(201);
    const candidateToken = (accepted.body as { accessToken: string })
      .accessToken;

    // 4. Ya es miembro `voluntario`: puede postularse a una actividad.
    const opportunity = await request(app.getHttpServer())
      .post('/volunteering/opportunities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Reparto de viandas',
        description: 'Entrega de viandas a domicilio los sábados.',
        startsAt: '2026-10-03T13:00:00.000Z',
        location: 'Bv. Sarmiento 1450, Villa María',
        capacity: 3,
      })
      .expect(201);
    const opportunityId = (opportunity.body as { id: string }).id;

    await request(app.getHttpServer())
      .post(`/volunteering/opportunities/${opportunityId}/applications`)
      .set('Authorization', `Bearer ${candidateToken}`)
      .expect(201);
  });

  it('CP-16-02: una solicitud sin nombre ni email se rechaza con 400 (class-validator)', async () => {
    const res = await submit({}).expect(400);
    const body = res.body as { message: string | string[] };
    // class-validator con el ValidationPipe global expone el detalle por campo.
    expect(Array.isArray(body.message) ? body.message.join(' ') : body.message)
      .toMatch(/nombre|correo/i);
  });

  it('CP-16-03: comprobación empírica — someter/aprobar dos veces el mismo email no está controlado en el alta, sí en la aprobación', async () => {
    const repeatedEmail = uniqueEmail('qk16cp-repetido');
    emails.push(repeatedEmail);

    // (a) Dos solicitudes con el mismo email: `submit()` no valida
    // duplicados, así que las dos quedan `pending` sin ningún error.
    const first = await submit({
      name: 'Primer intento',
      email: repeatedEmail,
    }).expect(201);
    const second = await submit({
      name: 'Segundo intento',
      email: repeatedEmail,
    }).expect(201);
    expect((first.body as RequestBody).status).toBe('pending');
    expect((second.body as RequestBody).status).toBe('pending');

    // (b) Se aprueba la primera: el email pasa a ser miembro activo tras
    // aceptar la invitación.
    const approvedFirst = await request(app.getHttpServer())
      .patch(`/volunteering/requests/${(first.body as RequestBody).id}/approve`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect((approvedFirst.body as { status: string }).status).toBe(
      'approved',
    );
    const token = await latestInvitationToken(repeatedEmail);
    await request(app.getHttpServer())
      .post(`/invitations/${token}/accept`)
      .send({ name: 'Primer intento', password: DEFAULT_PASSWORD })
      .expect(201);

    // (c) Se intenta aprobar la SEGUNDA solicitud, con el mismo email, que ya
    // es miembro activo de la organización. `MemberService.invite` rechaza
    // con `ConflictException` ("Ese correo ya es miembro de la
    // organización."), y el service de solicitudes no lo atrapa: propaga el
    // 409 tal cual. No hace falta forzar un control nuevo — el que ya existe
    // en `invite()` alcanza. Si esto devolviera 500 en vez de 409, sería
    // DEF-XX (ver informe).
    const res = await request(app.getHttpServer())
      .patch(
        `/volunteering/requests/${(second.body as RequestBody).id}/approve`,
      )
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(409);
  });

  it('CP-16-04: formato inválido — email mal formado y teléfono fuera de longitud se rechazan con 400', async () => {
    await submit({ name: 'Nombre válido', email: 'no-es-un-email' }).expect(
      400,
    );

    await submit({
      name: 'Nombre válido',
      email: uniqueEmail('qk16cp-telefono'),
      phone: '123', // menos de 6 caracteres
    }).expect(400);
  });

  it('CP-16-05 (adaptado): el alta es intencionalmente pública, no exige autenticación — comportamiento documentado en public-volunteer-request.controller.ts y aceptado en PROYECTO.md', async () => {
    // El PDF original pide 401 sin autenticación. Es lo opuesto de la
    // decisión real del equipo: el endpoint es público a propósito (mismo
    // molde que `PublicMonetaryDonationController`). Se verifica que
    // funciona SIN ningún header `Authorization`, no que falle.
    const res = await request(app.getHttpServer())
      .post(`/public/organizations/${orgId}/volunteer-requests`)
      .send({ name: 'Visitante sin sesión', email: uniqueEmail('qk16cp-anon') });
    // Sin cabecera Authorization en ningún momento de este request.
    expect(res.status).toBe(201);
    expect((res.body as RequestBody).status).toBe('pending');
  });

  it('rechaza mandar opportunityId y volunteerTypeId juntos (son excluyentes)', async () => {
    const opportunity = await request(app.getHttpServer())
      .post('/volunteering/opportunities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Excluyente',
        description: 'Actividad de prueba para la exclusión de campos.',
        startsAt: '2026-10-10T13:00:00.000Z',
        location: 'Sede',
        capacity: 2,
      })
      .expect(201);
    const opportunityId = (opportunity.body as { id: string }).id;

    const types = await request(app.getHttpServer())
      .get('/volunteer-types')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const volunteerTypeId = (types.body as { id: string }[])[0].id;

    await submit({
      name: 'Ambos campos',
      email: uniqueEmail('qk16cp-excluyente'),
      opportunityId,
      volunteerTypeId,
    }).expect(400);
  });

  it('solo un gestor (CONTENT_WRITER_ROLES) accede al panel de solicitudes; un voluntario no', async () => {
    const volunteerEmail = uniqueEmail('qk16cp-panel-voluntario');
    emails.push(volunteerEmail);
    const volunteer = await registerAndLogin(app, volunteerEmail);
    await dataSource.query(
      `INSERT INTO organization_memberships ("userId", "organizationId", role, active)
       VALUES ($1, $2, 'voluntario', true)`,
      [volunteer.userId, orgId],
    );
    const volunteerToken = await switchOrg(app, volunteer.token, orgId);

    await request(app.getHttpServer())
      .get('/volunteering/requests')
      .set('Authorization', `Bearer ${volunteerToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .get('/volunteering/requests')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
  });

  it('rechazar una solicitud exige un motivo, y queda con ese motivo', async () => {
    const submitted = await submit({
      name: 'A rechazar',
      email: uniqueEmail('qk16cp-rechazo'),
    }).expect(201);
    const id = (submitted.body as RequestBody).id;

    await request(app.getHttpServer())
      .patch(`/volunteering/requests/${id}/reject`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(400);

    const rejected = await request(app.getHttpServer())
      .patch(`/volunteering/requests/${id}/reject`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'No hay vacantes disponibles por ahora.' })
      .expect(200);
    expect((rejected.body as { status: string }).status).toBe('rejected');
    expect((rejected.body as { rejectReason: string }).rejectReason).toBe(
      'No hay vacantes disponibles por ahora.',
    );
  });
});
