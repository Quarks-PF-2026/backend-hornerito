/**
 * QK-20 · Gestionar Donación Virtual — CP-20-01 a CP-20-09
 *
 * El contrato original de la historia daba por hecha una pasarela de pago que
 * resolvía sola los estados "aprobada" y "fallida". En el refinamiento se
 * decidió **no implementar Mercado Pago todavía**: la plata se mueve por
 * transferencia bancaria, fuera del sistema, y el flujo pasa a ser en dos actos.
 *
 *   1. el donante, sin cuenta y anónimo si quiere, **declara** la donación;
 *   2. un owner o admin **confirma** o **rechaza** la recepción del dinero.
 *
 * De ahí las diferencias con el criterio de aceptación del PDF:
 *   - el "Caso 3 — pago rechazado" ya no lo produce una pasarela: lo produce
 *     una persona que no encontró el movimiento en el extracto (CP-20-04);
 *   - el comprobante/recibo del donante es el correo, no una pantalla, porque
 *     sin cuenta no hay a quién listarle un historial;
 *   - se agrega CP-20-08: el modelo contempla Mercado Pago, el endpoint no.
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
} from '../sprint2/helpers';

interface MonetaryDonation {
  id: string;
  amount: number;
  status: 'declarada' | 'confirmada' | 'rechazada';
  donorName: string | null;
  rejectReason: string | null;
  decidedAt: string | null;
}

describe('QK-20 Gestionar Donación Virtual (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let orgToken: string;
  let volunteerToken: string;
  let orgId: string;
  /** Segunda organización, para probar el aislamiento entre tenants. */
  let otherOrgId: string;
  let otherOrgToken: string;
  const orgIds: string[] = [];
  const emails: string[] = [];

  const ALIAS = 'comedor.hornero.mp';

  /** Devuelve el `Test` de supertest, no una promesa: hay que poder encadenar
   * `.expect()` con el código esperado en cada caso. */
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

  function listDonations(token: string, status?: string) {
    const req = request(app.getHttpServer())
      .get('/donations/monetary')
      .set('Authorization', `Bearer ${token}`);
    return status ? req.query({ status }) : req;
  }

  beforeAll(async () => {
    ({ app, dataSource } = await bootstrapApp());

    const ownerEmail = uniqueEmail('qk20-owner');
    emails.push(ownerEmail);
    const ownerSession = await registerAndLogin(app, ownerEmail);
    const org = await createOrganization(app, ownerSession.token);
    orgId = org.id;
    orgIds.push(orgId);
    orgToken = await switchOrg(app, ownerSession.token, orgId);

    // Los datos bancarios son la precondición del flujo: sin alias no hay a
    // dónde transferir y la organización no ofrece donar plata (CP-20-09).
    await request(app.getHttpServer())
      .put('/organization/me')
      .set('Authorization', `Bearer ${orgToken}`)
      .send({
        name: 'Comedor Manos del Barrio',
        description: 'Brindamos almuerzo y merienda a más de 80 chicos.',
        address: 'Bv. Sarmiento 1450, Villa María, Córdoba',
        contact: '353 412-7788',
        paymentAlias: ALIAS,
        paymentHolder: 'Asociación Manos del Barrio',
        paymentCuit: '30-71234567-8',
        paymentBank: 'Banco Nación',
      })
      .expect(200);

    // Voluntario: no puede decidir sobre el dinero (CP-20-06).
    const volunteerEmail = uniqueEmail('qk20-volunteer');
    emails.push(volunteerEmail);
    await request(app.getHttpServer())
      .post('/organization/members/invitations')
      .set('Authorization', `Bearer ${orgToken}`)
      .send({ email: volunteerEmail, role: 'voluntario' })
      .expect(201);
    const rows: Array<{ token: string }> = await dataSource.query(
      `SELECT token FROM organization_invitations
       WHERE email = $1 AND "organizationId" = $2
       ORDER BY "createdAt" DESC LIMIT 1`,
      [volunteerEmail, orgId],
    );
    const accepted = await request(app.getHttpServer())
      .post(`/invitations/${rows[0].token}/accept`)
      .send({ name: 'Voluntario de prueba', password: DEFAULT_PASSWORD })
      .expect(201);
    volunteerToken = (accepted.body as { accessToken: string }).accessToken;

    // Organización ajena, sin datos bancarios (CP-20-07 y CP-20-09).
    const otherEmail = uniqueEmail('qk20-other');
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

  it('CP-20-01: un visitante sin sesión declara una donación y queda pendiente', async () => {
    const res = await declare(orgId, {
      amount: 5000,
      method: 'transferencia',
      operationNumber: 'OP-123456',
      donorName: 'Ana Gómez',
    }).expect(201);

    const created = res.body as { id: string; status: string };
    expect(created.status).toBe('declarada');

    const list = await listDonations(orgToken).expect(200);
    const donations = list.body as MonetaryDonation[];
    const found = donations.find((d) => d.id === created.id)!;
    expect(found.amount).toBe(5000);
    expect(found.donorName).toBe('Ana Gómez');
    expect(found.decidedAt).toBeNull();
  });

  it('CP-20-01b: se puede donar de forma totalmente anónima', async () => {
    const res = await declare(orgId, {
      amount: 1500,
      method: 'transferencia',
    }).expect(201);

    expect((res.body as { status: string }).status).toBe('declarada');
  });

  it('CP-20-02: un monto inválido se bloquea y no persiste', async () => {
    for (const amount of [0, -100, 50]) {
      await declare(orgId, { amount, method: 'transferencia' }).expect(400);
    }

    const list = await listDonations(orgToken).expect(200);
    const amounts = (list.body as MonetaryDonation[]).map((d) => d.amount);
    expect(amounts).not.toContain(0);
    expect(amounts).not.toContain(-100);
    expect(amounts).not.toContain(50);
  });

  it('CP-20-03: el dueño confirma la recepción y queda la traza', async () => {
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

  it('CP-20-04: se rechaza con motivo; sin motivo no se permite', async () => {
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

    const res = await request(app.getHttpServer())
      .post(`/donations/monetary/${id}/reject`)
      .set('Authorization', `Bearer ${orgToken}`)
      .send({ rejectReason: 'No figura en el extracto bancario' })
      .expect(201);

    const rejected = res.body as MonetaryDonation;
    expect(rejected.status).toBe('rechazada');
    expect(rejected.rejectReason).toBe('No figura en el extracto bancario');
  });

  it('CP-20-05: una donación ya decidida no se vuelve a decidir', async () => {
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

  it('CP-20-06: un voluntario ve el historial pero no puede decidir', async () => {
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

  it('CP-20-07: otra organización no ve ni decide la donación', async () => {
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

  it('CP-20-08: Mercado Pago está contemplado en el modelo pero no disponible', async () => {
    await declare(orgId, { amount: 5000, method: 'mercadopago' }).expect(501);
  });

  it('CP-20-09: sin datos bancarios la organización no recibe donaciones', async () => {
    await declare(otherOrgId, {
      amount: 5000,
      method: 'transferencia',
    }).expect(409);
  });

  it('CP-20-10: el historial se puede filtrar por estado', async () => {
    const list = await listDonations(orgToken, 'confirmada').expect(200);
    const donations = list.body as MonetaryDonation[];
    expect(donations.length).toBeGreaterThan(0);
    expect(donations.every((d) => d.status === 'confirmada')).toBe(true);
  });

  it('la donación económica no aparece en el historial de presenciales', async () => {
    await declare(orgId, { amount: 9000, method: 'transferencia' }).expect(201);

    const res = await request(app.getHttpServer())
      .get('/donations')
      .set('Authorization', `Bearer ${orgToken}`)
      .expect(200);

    // `GET /donations` es el historial de QK-26. Comparten tabla, no historial.
    expect(res.body as unknown[]).toHaveLength(0);
  });
});
