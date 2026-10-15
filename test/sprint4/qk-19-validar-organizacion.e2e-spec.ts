/**
 * QK-19 · Validar organización — CP-19-01 a CP-19-08
 * Casos tal como figuran en "DOC TESTEO BACK.pdf" (backend, capa API/DB).
 *
 * Contrato real verificado en `admin-organization.controller.ts` /
 * `organization.service.ts` / `reject-organization.dto.ts`:
 *   - `/admin/organizations/*` está detrás de `JwtAuthGuard` +
 *     `PlatformAdminGuard` a nivel de controller (alcanza a `pending`,
 *     `validate` y `reject` por igual).
 *   - `PATCH .../validate` y `PATCH .../reject` hacen un UPDATE condicional
 *     `pending -> status`: si no afecta filas, distingue 404 (no existe) de
 *     409 (ya salió de pending) con una lectura extra.
 *   - El motivo de rechazo se persiste con `.trim()` aplicado en el
 *     service (no en el DTO — ver CP-19-03 más abajo).
 *   - `GET /admin/organizations/pending` devuelve solo `status = pending`,
 *     con los datos del owner embebidos.
 *
 * CP-19-08 queda como `it.todo`: la compuerta por `organization.status` para
 * crear necesidades/donaciones no está implementada (`NeedController` y
 * `DonationController` solo exigen rol + tenant activo, sin mirar el estado
 * de la organización — verificado por lectura directa de ambos controllers).
 * No es un defecto: está fuera del código entregable comprometido en el
 * sprint, tal como lo aclara el propio documento de casos.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { MailService } from '../../src/modules/mail/mail.service';
import {
  bootstrapApp,
  cleanupOrganizations,
  cleanupUsers,
  createPendingOrganization,
  createPlatformAdmin,
  getOrganizationRow,
  messagesOf,
  registerAndLogin,
  uniqueEmail,
  type Session,
} from './helpers';

const NON_EXISTENT_UUID = '11111111-1111-1111-1111-111111111111';

describe('QK-19 · Validar organización (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let admin: Session;
  const emails: string[] = [];
  const orgIds: string[] = [];

  beforeAll(async () => {
    ({ app, dataSource } = await bootstrapApp());
    const adminEmail = uniqueEmail('qk19-admin');
    emails.push(adminEmail);
    admin = await createPlatformAdmin(app, adminEmail);
  });

  afterAll(async () => {
    await cleanupOrganizations(dataSource, orgIds);
    await cleanupUsers(dataSource, emails);
    await app.close();
  });

  async function newPendingOrg(prefix: string, name?: string) {
    const ownerEmail = uniqueEmail(prefix);
    emails.push(ownerEmail);
    const org = await createPendingOrganization(app, ownerEmail, {
      ...(name ? { name } : {}),
    });
    orgIds.push(org.id);
    return org;
  }

  it('CP-19-01: aprobar una organización pendiente la deja validada y notifica al owner', async () => {
    const org = await newPendingOrg('cp19-01', 'Está saliendo el sol');
    const mailSpy = jest.spyOn(app.get(MailService), 'send').mockClear();

    await request(app.getHttpServer())
      .patch(`/admin/organizations/${org.id}/validate`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send()
      .expect(200);

    const row = await getOrganizationRow(dataSource, org.id);
    expect(row?.status).toBe('validated');

    expect(mailSpy).toHaveBeenCalledWith(
      expect.objectContaining({ to: org.ownerEmail }),
    );
    mailSpy.mockRestore();
  });

  it('CP-19-02: rechazar con motivo la deja rechazada, motivo trimmeado y notifica con ese motivo', async () => {
    const org = await newPendingOrg('cp19-02');
    const mailSpy = jest.spyOn(app.get(MailService), 'send').mockClear();

    await request(app.getHttpServer())
      .patch(`/admin/organizations/${org.id}/reject`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ reason: ' Documentación incompleta ' })
      .expect(200);

    const row = await getOrganizationRow(dataSource, org.id);
    expect(row?.status).toBe('rejected');
    expect(row?.rejectReason).toBe('Documentación incompleta');

    expect(mailSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        to: org.ownerEmail,
        text: expect.stringContaining('Documentación incompleta'),
      }),
    );
    mailSpy.mockRestore();
  });

  it('CP-19-03: rechazar sin un motivo válido es 400 y no cambia el estado', async () => {
    const org = await newPendingOrg('cp19-03');

    const empty = await request(app.getHttpServer())
      .patch(`/admin/organizations/${org.id}/reject`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ reason: '' })
      .expect(400);
    expect(messagesOf(empty.body)).toContain('Ingresá el motivo del rechazo.');

    const missing = await request(app.getHttpServer())
      .patch(`/admin/organizations/${org.id}/reject`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({})
      .expect(400);
    expect(messagesOf(missing.body)).toContain(
      'Ingresá el motivo del rechazo.',
    );

    const tooLong = await request(app.getHttpServer())
      .patch(`/admin/organizations/${org.id}/reject`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ reason: 'x'.repeat(501) })
      .expect(400);
    expect(messagesOf(tooLong.body)).toContain(
      'El motivo no puede superar los 500 caracteres.',
    );

    // Caso (b), motivo compuesto solo por espacios — ver hallazgo en el
    // header del suite y en el reporte de QA: `RejectOrganizationDto` no
    // trimmea antes de `@IsNotEmpty`, así que " " pasa la validación como si
    // tuviera contenido y el service la persiste con rejectReason vacío en
    // lugar de devolver 400. Se deja la aserción del comportamiento
    // DOCUMENTADO (400) a propósito, como evidencia formal del defecto —
    // mismo criterio que `test/sprint2/qk-17-password-reset.e2e-spec.ts`.
    const blank = await request(app.getHttpServer())
      .patch(`/admin/organizations/${org.id}/reject`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ reason: '   ' })
      .expect(400);
    expect(messagesOf(blank.body)).toContain('Ingresá el motivo del rechazo.');

    const row = await getOrganizationRow(dataSource, org.id);
    expect(row?.status).toBe('pending');
  });

  it('CP-19-04: la cola de pendientes trae solo pendientes, con los datos del owner', async () => {
    const pending = await newPendingOrg('cp19-04-pending', 'Comedor Pendiente QA');
    const validated = await newPendingOrg(
      'cp19-04-validated',
      'Comedor Ya Validado QA',
    );
    await request(app.getHttpServer())
      .patch(`/admin/organizations/${validated.id}/validate`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send()
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/admin/organizations/pending')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);

    const rows = res.body as Array<{
      id: string;
      name: string;
      description: string;
      address: string;
      contact: string;
      createdAt: string;
      owner: { name: string; email: string };
    }>;
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(pending.id);
    expect(ids).not.toContain(validated.id);

    const row = rows.find((r) => r.id === pending.id)!;
    expect(row.name).toBe('Comedor Pendiente QA');
    expect(row).toEqual(
      expect.objectContaining({
        description: expect.any(String),
        address: expect.any(String),
        contact: expect.any(String),
        createdAt: expect.any(String),
        owner: expect.objectContaining({
          name: expect.any(String),
          email: pending.ownerEmail,
        }),
      }),
    );
  });

  it('CP-19-05: re-decidir sobre una organización que ya salió de pendiente es 409 y no altera el estado', async () => {
    const org = await newPendingOrg('cp19-05');
    await request(app.getHttpServer())
      .patch(`/admin/organizations/${org.id}/validate`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send()
      .expect(200);

    const res = await request(app.getHttpServer())
      .patch(`/admin/organizations/${org.id}/validate`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send()
      .expect(409);
    expect((res.body as { message: string }).message).toBe(
      'Solo se puede validar una organización pendiente.',
    );

    const row = await getOrganizationRow(dataSource, org.id);
    expect(row?.status).toBe('validated');
  });

  it('CP-19-06: validar/rechazar una organización inexistente (UUID válido) es 404', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/admin/organizations/${NON_EXISTENT_UUID}/validate`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send()
      .expect(404);
    expect((res.body as { message: string }).message).toBe(
      'La organización no existe.',
    );
  });

  it('CP-19-07: el panel está protegido — sin token 401, sin ser platform admin 403', async () => {
    const org = await newPendingOrg('cp19-07');

    await request(app.getHttpServer())
      .patch(`/admin/organizations/${org.id}/validate`)
      .send()
      .expect(401);

    const commonEmail = uniqueEmail('cp19-07-common');
    emails.push(commonEmail);
    const common = await registerAndLogin(app, commonEmail);

    await request(app.getHttpServer())
      .patch(`/admin/organizations/${org.id}/validate`)
      .set('Authorization', `Bearer ${common.token}`)
      .send()
      .expect(403);

    const row = await getOrganizationRow(dataSource, org.id);
    expect(row?.status).toBe('pending');
  });

  // No ejecutable en Sprint 4 (ver header): la compuerta por
  // organization.status no está implementada en NeedController ni en
  // DonationController. No es un defecto — es alcance no comprometido.
  it.todo(
    'CP-19-08: una organización no validada no puede publicar necesidades ni recibir donaciones',
  );
});
