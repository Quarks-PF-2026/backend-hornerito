/**
 * Tipo de cuenta (donante / organización), elegido al registrarse.
 *
 * Prueba contra la base real lo que los unit tests solo pueden mockear: que la
 * columna nace con el default de la migración, que el backend relee el tipo de
 * la base al crear una organización, y que la donación de una cuenta de
 * organización queda persistida sin asociarse a esa cuenta.
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
  uniqueEmail,
} from './sprint2/helpers';

const PERFIL = {
  name: 'Comedor Manos del Barrio',
  description: 'Brindamos almuerzo y merienda a más de 80 chicos.',
  address: 'Bv. Sarmiento 1450, Villa María, Córdoba',
  contact: '353 412-7788',
};

describe('Tipo de cuenta (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const orgIds: string[] = [];
  const emails: string[] = [];

  function newEmail(prefix: string): string {
    const email = uniqueEmail(prefix);
    emails.push(email);
    return email;
  }

  beforeAll(async () => {
    ({ app, dataSource } = await bootstrapApp());
  });

  afterAll(async () => {
    await cleanupOrganizations(dataSource, orgIds);
    await cleanupUsers(dataSource, emails);
    await app.close();
  });

  it('una cuenta de donante no puede crear una organización', async () => {
    const donor = await registerAndLogin(
      app,
      newEmail('acct-donor'),
      DEFAULT_PASSWORD,
      'donor',
    );

    const res = await request(app.getHttpServer())
      .put('/organization/me')
      .set('Authorization', `Bearer ${donor.token}`)
      .send(PERFIL)
      .expect(403);

    expect((res.body as { message: string }).message).toBe(
      'Las cuentas de donante no pueden crear una organización.',
    );
  });

  it('una cuenta de organización crea su organización, que nace pendiente', async () => {
    const owner = await registerAndLogin(app, newEmail('acct-org'));

    const res = await request(app.getHttpServer())
      .put('/organization/me')
      .set('Authorization', `Bearer ${owner.token}`)
      .send(PERFIL)
      .expect(200);

    const org = res.body as { id: string; status: string };
    orgIds.push(org.id);
    expect(org.status).toBe('pending');
  });

  it('el login informa el tipo de cuenta, y sin elegirlo la cuenta nace donante', async () => {
    const email = newEmail('acct-default');
    // Registro sin `accountType`: lo que manda un cliente viejo.
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        name: 'Usuario de prueba',
        email,
        password: DEFAULT_PASSWORD,
        confirmPassword: DEFAULT_PASSWORD,
        acceptedTerms: true,
      })
      .expect(201);
    await dataSource.query(
      `UPDATE users SET "emailVerified" = true WHERE email = $1`,
      [email],
    );

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: DEFAULT_PASSWORD })
      .expect(200);

    expect(
      (res.body as { user: { accountType: string } }).user.accountType,
    ).toBe('donor');
  });

  it('rechaza un tipo de cuenta inválido', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        name: 'Usuario de prueba',
        email: newEmail('acct-invalid'),
        password: DEFAULT_PASSWORD,
        confirmPassword: DEFAULT_PASSWORD,
        acceptedTerms: true,
        accountType: 'admin',
      })
      .expect(400);
  });

  describe('donación económica con sesión', () => {
    let organizationId: string;

    beforeAll(async () => {
      const owner = await registerAndLogin(app, newEmail('acct-recv'));
      const org = await createOrganization(app, owner.token);
      organizationId = org.id;
      orgIds.push(organizationId);
      // Sin alias la organización no recibe donaciones económicas.
      await dataSource.query(
        `UPDATE organizations SET "paymentAlias" = 'comedor.hornero.mp' WHERE id = $1`,
        [organizationId],
      );
    });

    async function declareAs(token: string): Promise<string | null> {
      const res = await request(app.getHttpServer())
        .post(`/public/organizations/${organizationId}/donations`)
        .set('Authorization', `Bearer ${token}`)
        .field({ amount: '5000', method: 'transferencia' })
        .expect(201);
      const [row]: Array<{ donorUserId: string | null }> =
        await dataSource.query(
          `SELECT "donorUserId" FROM donations WHERE id = $1`,
          [(res.body as { id: string }).id],
        );
      return row.donorUserId;
    }

    it('la de una cuenta de organización no queda asociada a esa cuenta', async () => {
      const orgAccount = await registerAndLogin(app, newEmail('acct-org-don'));

      expect(await declareAs(orgAccount.token)).toBeNull();
    });

    it('la de una cuenta de donante sí queda asociada a su cuenta', async () => {
      const donor = await registerAndLogin(
        app,
        newEmail('acct-donor-don'),
        DEFAULT_PASSWORD,
        'donor',
      );

      expect(await declareAs(donor.token)).toBe(donor.userId);
    });
  });
});
