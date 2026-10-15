/**
 * QK-20 · Gestionar Donación Económica — trazabilidad CP-20-01 a CP-20-13
 *
 * Suite NUEVA de trazabilidad QA, aparte de
 * `test/sprint3/qk-20-monetary-donation.e2e-spec.ts` (regresión real del
 * equipo, numerada PU-x). No se toca ese archivo.
 *
 * Contrato real verificado en `create-monetary-donation.dto.ts`,
 * `monetary-donation.entity.ts`, `monetary-donation.controller.ts`,
 * `public-monetary-donation.controller.ts` y `monetary-donation.service.ts`:
 *   - Declarar es público, SIN autenticación, multipart (`POST
 *     /public/organizations/:organizationId/donations`), y nace `declarada`.
 *   - `MIN_DONATION_AMOUNT = 100`, `MAX_UPLOAD_BYTES = 8_000_000`.
 *   - Confirmar/rechazar (`POST /donations/monetary/:id/confirm|reject`) es
 *     `MEMBER_MANAGER_ROLES` (owner/admin) — el coordinador NO puede, a
 *     diferencia del registro de donaciones presenciales (QK-26).
 *   - Estados terminales: re-decidir devuelve 409 (`ConflictException`).
 *   - `GET /donations/monetary` es un array plano, sin `@Roles` (cualquier
 *     miembro activo).
 *
 * CP-20-10 (flujo de pago real con Mercado Pago) queda como `it.todo`: no está
 * implementado (Sprint 5), y el enum `mercadopago` responde 501 a propósito.
 *
 * Subida de comprobante (CP-20-13): `.env.test` ya trae credenciales reales
 * de una cuenta de Cloudinary de test, así que el caso corre de punta a
 * punta contra Cloudinary de verdad (sin mocks) — sube un PNG 1x1 real y
 * después confirma por `GET /donations/monetary` que `receiptUrl` quedó
 * asociado.
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

interface MonetaryDonation {
  id: string;
  amount: number;
  status: 'declarada' | 'confirmada' | 'rechazada';
  donorName: string | null;
  donorContact: string | null;
  rejectReason: string | null;
  decidedAt: string | null;
  receiptUrl: string | null;
}

describe('QK-20 · Gestionar Donación Económica — trazabilidad CP-20 (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let orgToken: string;
  let coordinatorToken: string;
  let volunteerToken: string;
  let orgId: string;
  let otherOrgId: string;
  let otherOrgToken: string;
  const orgIds: string[] = [];
  const emails: string[] = [];

  function declare(
    organizationId: string,
    body: Record<string, string | number>,
  ) {
    return request(app.getHttpServer())
      .post(`/public/organizations/${organizationId}/donations`)
      .field(
        Object.fromEntries(
          Object.entries(body).map(([k, v]) => [k, String(v)]),
        ),
      );
  }

  function listDonations(token: string, query: Record<string, string> = {}) {
    return request(app.getHttpServer())
      .get('/donations/monetary')
      .query(query)
      .set('Authorization', `Bearer ${token}`);
  }

  async function addMember(
    userId: string,
    organizationId: string,
    role: string,
  ): Promise<void> {
    await dataSource.query(
      `INSERT INTO organization_memberships ("userId", "organizationId", role, active)
       VALUES ($1, $2, $3, true)`,
      [userId, organizationId, role],
    );
  }

  beforeAll(async () => {
    ({ app, dataSource } = await bootstrapApp());

    const ownerEmail = uniqueEmail('qk20cp-owner');
    emails.push(ownerEmail);
    const ownerSession = await registerAndLogin(app, ownerEmail);
    const org = await createOrganization(app, ownerSession.token);
    orgId = org.id;
    orgIds.push(orgId);
    orgToken = await switchOrg(app, ownerSession.token, orgId);

    // Datos bancarios: precondición para que la organización reciba donaciones.
    await request(app.getHttpServer())
      .put('/organization/me')
      .set('Authorization', `Bearer ${orgToken}`)
      .send({
        name: 'Comedor Manos del Barrio',
        description: 'Brindamos almuerzo y merienda a más de 80 chicos.',
        address: 'Bv. Sarmiento 1450, Villa María, Córdoba',
        contact: '353 412-7788',
        paymentAlias: 'comedor.hornero.mp',
        paymentHolder: 'Asociación Manos del Barrio',
        paymentCuit: '30-71234567-8',
        paymentBank: 'Banco Nación',
      })
      .expect(200);

    const coordinatorEmail = uniqueEmail('qk20cp-coordinador');
    emails.push(coordinatorEmail);
    const coordinatorSession = await registerAndLogin(app, coordinatorEmail);
    await addMember(coordinatorSession.userId, orgId, 'coordinador');
    coordinatorToken = await switchOrg(app, coordinatorSession.token, orgId);

    const volunteerEmail = uniqueEmail('qk20cp-volunteer');
    emails.push(volunteerEmail);
    const volunteerSession = await registerAndLogin(app, volunteerEmail);
    await addMember(volunteerSession.userId, orgId, 'voluntario');
    volunteerToken = await switchOrg(app, volunteerSession.token, orgId);

    // Segunda organización, sin datos bancarios: CP-20-09 y aislamiento.
    const otherEmail = uniqueEmail('qk20cp-other');
    emails.push(otherEmail);
    const otherSession = await registerAndLogin(app, otherEmail);
    const otherOrg = await createOrganization(app, otherSession.token, {
      name: 'Comedor La Esquina',
    });
    otherOrgId = otherOrg.id;
    orgIds.push(otherOrgId);
    otherOrgToken = await switchOrg(app, otherSession.token, otherOrgId);
  });

  afterAll(async () => {
    await cleanupOrganizations(dataSource, orgIds);
    await cleanupUsers(dataSource, emails);
    await app.close();
  });

  it('CP-20-01: un visitante sin sesión declara una donación válida y queda "declarada"', async () => {
    const res = await declare(orgId, {
      amount: 5000,
      method: 'transferencia',
      operationNumber: 'OP-123456',
      donorName: 'Ana Gómez',
      donorContact: 'ana@test.com',
    }).expect(201);

    const created = res.body as { id: string; status: string };
    expect(created.status).toBe('declarada');

    const list = await listDonations(orgToken).expect(200);
    const found = (list.body as MonetaryDonation[]).find(
      (d) => d.id === created.id,
    )!;
    expect(found.amount).toBe(5000);
    expect(found.donorName).toBe('Ana Gómez');
    expect(found.decidedAt).toBeNull();
  });

  it('CP-20-02: se puede donar de forma totalmente anónima (sin donorName ni donorContact)', async () => {
    const res = await declare(orgId, {
      amount: 1500,
      method: 'transferencia',
    }).expect(201);

    const created = res.body as { id: string; status: string };
    expect(created.status).toBe('declarada');

    const list = await listDonations(orgToken).expect(200);
    const found = (list.body as MonetaryDonation[]).find(
      (d) => d.id === created.id,
    )!;
    expect(found.donorName).toBeNull();
    expect(found.donorContact).toBeNull();
  });

  it('CP-20-03: un monto inválido (cero, negativo, bajo el mínimo o con más de 2 decimales) se rechaza y no persiste', async () => {
    for (const amount of [0, -100, 50]) {
      await declare(orgId, { amount, method: 'transferencia' }).expect(400);
    }
    await declare(orgId, { amount: 100.999, method: 'transferencia' }).expect(
      400,
    );

    const list = await listDonations(orgToken).expect(200);
    const amounts = (list.body as MonetaryDonation[]).map((d) => d.amount);
    expect(amounts).not.toContain(0);
    expect(amounts).not.toContain(-100);
    expect(amounts).not.toContain(50);
  });

  it('CP-20-04: el owner confirma la recepción y queda la traza de quién y cuándo', async () => {
    const created = await declare(orgId, {
      amount: 8000,
      method: 'transferencia',
    }).expect(201);
    const id = (created.body as { id: string }).id;

    const res = await request(app.getHttpServer())
      .post(`/donations/monetary/${id}/confirm`)
      .set('Authorization', `Bearer ${orgToken}`)
      .expect(201);

    const confirmed = res.body as MonetaryDonation;
    expect(confirmed.status).toBe('confirmada');
    expect(confirmed.decidedAt).not.toBeNull();
  });

  it('CP-20-05: se rechaza con motivo; sin motivo o con un motivo demasiado corto no se permite', async () => {
    const created = await declare(orgId, {
      amount: 2000,
      method: 'transferencia',
    }).expect(201);
    const id = (created.body as { id: string }).id;

    await request(app.getHttpServer())
      .post(`/donations/monetary/${id}/reject`)
      .set('Authorization', `Bearer ${orgToken}`)
      .send({})
      .expect(400);

    await request(app.getHttpServer())
      .post(`/donations/monetary/${id}/reject`)
      .set('Authorization', `Bearer ${orgToken}`)
      .send({ rejectReason: 'no' })
      .expect(400);

    const res = await request(app.getHttpServer())
      .post(`/donations/monetary/${id}/reject`)
      .set('Authorization', `Bearer ${orgToken}`)
      .send({ rejectReason: 'No figura en el extracto bancario' })
      .expect(201);

    const rejected = res.body as MonetaryDonation;
    expect(rejected.status).toBe('rechazada');
    expect(rejected.rejectReason).toBe('No figura en el extracto bancario');
  });

  it('CP-20-06: una donación ya decidida (confirmada o rechazada) no se vuelve a decidir (409)', async () => {
    const created = await declare(orgId, {
      amount: 3000,
      method: 'transferencia',
    }).expect(201);
    const id = (created.body as { id: string }).id;

    await request(app.getHttpServer())
      .post(`/donations/monetary/${id}/confirm`)
      .set('Authorization', `Bearer ${orgToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/donations/monetary/${id}/confirm`)
      .set('Authorization', `Bearer ${orgToken}`)
      .expect(409);

    await request(app.getHttpServer())
      .post(`/donations/monetary/${id}/reject`)
      .set('Authorization', `Bearer ${orgToken}`)
      .send({ rejectReason: 'me arrepentí' })
      .expect(409);
  });

  it('CP-20-07: un coordinador ve el historial pero NO puede confirmar ni rechazar (403)', async () => {
    const created = await declare(orgId, {
      amount: 4500,
      method: 'transferencia',
    }).expect(201);
    const id = (created.body as { id: string }).id;

    await listDonations(coordinatorToken).expect(200);

    await request(app.getHttpServer())
      .post(`/donations/monetary/${id}/confirm`)
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/donations/monetary/${id}/reject`)
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({ rejectReason: 'motivo cualquiera' })
      .expect(403);
  });

  it('CP-20-08: un voluntario ve el historial pero NO puede decidir (403)', async () => {
    const created = await declare(orgId, {
      amount: 4000,
      method: 'transferencia',
    }).expect(201);
    const id = (created.body as { id: string }).id;

    await listDonations(volunteerToken).expect(200);

    await request(app.getHttpServer())
      .post(`/donations/monetary/${id}/confirm`)
      .set('Authorization', `Bearer ${volunteerToken}`)
      .expect(403);
  });

  it('CP-20-09: otra organización no ve ni puede decidir sobre la donación (aislamiento, 404)', async () => {
    const created = await declare(orgId, {
      amount: 7000,
      method: 'transferencia',
    }).expect(201);
    const id = (created.body as { id: string }).id;

    const list = await listDonations(otherOrgToken).expect(200);
    expect((list.body as MonetaryDonation[]).map((d) => d.id)).not.toContain(
      id,
    );

    await request(app.getHttpServer())
      .post(`/donations/monetary/${id}/confirm`)
      .set('Authorization', `Bearer ${otherOrgToken}`)
      .expect(404);
  });

  // Bloqueado: MercadoPago no implementado (Sprint 5). No ejecutable, no es defecto.
  it.todo(
    'CP-20-10: el flujo de pago real con Mercado Pago (preference, webhook, confirmación automática)',
  );

  it('CP-20-11: Mercado Pago está contemplado en el modelo (enum) pero el endpoint lo rechaza con 501', async () => {
    await declare(orgId, { amount: 5000, method: 'mercadopago' }).expect(501);
  });

  it('CP-20-12: sin datos bancarios cargados, la organización no recibe donaciones económicas (409)', async () => {
    await declare(otherOrgId, {
      amount: 5000,
      method: 'transferencia',
    }).expect(409);
  });

  it('CP-20-13: comprobante con contenido inválido se rechaza (400)', async () => {
    await request(app.getHttpServer())
      .post(`/public/organizations/${orgId}/donations`)
      .field({ amount: '3000', method: 'transferencia' })
      .attach('receipt', Buffer.from('esto no es una imagen'), {
        filename: 'comprobante.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400);
  });

  it('CP-20-13: al declarar con un comprobante válido, queda asociado a la donación (sube a Cloudinary real)', async () => {
    // PNG 1x1 real y mínimo: pasa el chequeo de magic bytes de
    // `detectImageMime` (src/modules/media/media-purposes.ts) y es liviano
    // para no pegarle feo a la cuenta de Cloudinary de test.
    const validPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );

    const created = await request(app.getHttpServer())
      .post(`/public/organizations/${orgId}/donations`)
      .field({ amount: '3000', method: 'transferencia' })
      .attach('receipt', validPng, {
        filename: 'comprobante.png',
        contentType: 'image/png',
      })
      .expect(201);

    const { id, status } = created.body as { id: string; status: string };
    expect(status).toBe('declarada');

    // El POST no devuelve `receiptUrl`; se confirma que quedó asociado
    // consultando el historial autenticado.
    const list = await listDonations(orgToken).expect(200);
    const found = (list.body as MonetaryDonation[]).find((d) => d.id === id)!;
    expect(found.receiptUrl).not.toBeNull();
    expect(typeof found.receiptUrl).toBe('string');
    expect(found.receiptUrl!.startsWith('http')).toBe(true);
  });

  it('la donación económica no aparece en el historial de presenciales (QK-26) y viceversa', async () => {
    const declared = await declare(orgId, {
      amount: 9000,
      method: 'transferencia',
    }).expect(201);

    const inPerson = await request(app.getHttpServer())
      .get('/donations')
      .set('Authorization', `Bearer ${orgToken}`)
      .expect(200);
    expect(
      (inPerson.body as { id: string }[]).some(
        (d) => d.id === (declared.body as { id: string }).id,
      ),
    ).toBe(false);
  });
});
