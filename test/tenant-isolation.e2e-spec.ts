import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  bootstrapApp,
  cleanupOrganizations,
  cleanupUsers,
  createOrganization,
  registerAndLogin,
  uniqueEmail,
} from './sprint2/helpers';

const APP_ROLE = 'hornerito_app';

/**
 * El aislamiento entre organizaciones ahora es por columna `organizationId`
 * más políticas RLS. Estos casos cubren las dos capas: que la API no cruce
 * datos, y que la base tampoco los deje cruzar aunque la query venga sin
 * filtro.
 */
describe('Tenant isolation (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  const orgIds: string[] = [];
  const emails: string[] = [];

  let tokenA: string;
  let tokenB: string;
  let orgA: string;
  let orgB: string;
  let supplyIdA: string;

  beforeAll(async () => {
    ({ app, dataSource } = await bootstrapApp());

    const emailA = uniqueEmail('tenant-a');
    const emailB = uniqueEmail('tenant-b');
    emails.push(emailA, emailB);

    const sessionA = await registerAndLogin(app, emailA);
    const orgAResult = await createOrganization(app, sessionA.token, {
      name: 'Comedor A',
    });
    orgA = orgAResult.id;
    orgIds.push(orgA);
    tokenA = (await login(emailA)).token;

    const sessionB = await registerAndLogin(app, emailB);
    const orgBResult = await createOrganization(app, sessionB.token, {
      name: 'Comedor B',
    });
    orgB = orgBResult.id;
    orgIds.push(orgB);
    tokenB = (await login(emailB)).token;

    const created = await request(app.getHttpServer())
      .post('/supplies')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Arroz', category: 'Alimentos secos', unit: 'Kilogramos' })
      .expect(201);
    supplyIdA = (created.body as { id: string }).id;
  });

  afterAll(async () => {
    await cleanupOrganizations(dataSource, orgIds);
    await cleanupUsers(dataSource, emails);
    await app.close();
  });

  /**
   * El token que devuelve `registerAndLogin` se emite antes de que exista la
   * organización, así que no trae `orgId`. Volver a loguearse lo incluye.
   */
  async function login(email: string) {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password1' })
      .expect(200);
    return { token: (res.body as { accessToken: string }).accessToken };
  }

  /** Corre SQL con el rol y el contexto de tenant de una request real. */
  async function asTenant<T>(
    organizationId: string | null,
    sql: string,
    params: unknown[] = [],
  ): Promise<T> {
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await queryRunner.query(`SET ROLE "${APP_ROLE}"`);
      if (organizationId) {
        await queryRunner.query(`SELECT set_config($1, $2, false)`, [
          'app.current_org',
          organizationId,
        ]);
      }
      return (await queryRunner.query(sql, params)) as T;
    } finally {
      await queryRunner.query(`RESET ROLE`).catch(() => undefined);
      await queryRunner.query(`RESET app.current_org`).catch(() => undefined);
      await queryRunner.release();
    }
  }

  it('no deja ver por la API los insumos de otra organización', async () => {
    const mine = await request(app.getHttpServer())
      .get('/supplies')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect((mine.body as Array<{ id: string }>).map((s) => s.id)).toContain(
      supplyIdA,
    );

    const theirs = await request(app.getHttpServer())
      .get('/supplies')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(
      (theirs.body as Array<{ id: string }>).map((s) => s.id),
    ).not.toContain(supplyIdA);
  });

  it('no deja tocar por id un insumo de otra organización', async () => {
    await request(app.getHttpServer())
      .patch(`/supplies/${supplyIdA}/toggle`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  it('RLS oculta las filas de otra organización aunque la query no filtre', async () => {
    const seenByA = await asTenant<Array<{ id: string }>>(
      orgA,
      `SELECT id FROM supplies`,
    );
    expect(seenByA.map((row) => row.id)).toContain(supplyIdA);

    const seenByB = await asTenant<Array<{ id: string }>>(
      orgB,
      `SELECT id FROM supplies`,
    );
    expect(seenByB.map((row) => row.id)).not.toContain(supplyIdA);
  });

  it('sin organización en la sesión, el rol de la app no ve nada', async () => {
    const rows = await asTenant<Array<{ count: string }>>(
      null,
      `SELECT count(*)::int AS count FROM supplies`,
    );
    expect(rows[0].count).toBe(0);
  });

  it('RLS rechaza escribir una fila con la organización de otro', async () => {
    await expect(
      asTenant(
        orgB,
        `INSERT INTO supplies ("organizationId", name, category, unit)
         VALUES ($1, 'Intruso', 'Alimentos secos', 'Kilogramos')`,
        [orgA],
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});
