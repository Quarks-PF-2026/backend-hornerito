import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { TenantConnectionService } from '../src/modules/tenant/tenant-connection.service';
import { schemaNameFor } from '../src/modules/tenant/tenant-schema.util';

describe('Tenant isolation (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tenantConnectionService: TenantConnectionService;
  const createdOrgIds: string[] = [];
  const createdEmails: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    dataSource = app.get(DataSource);
    tenantConnectionService = app.get(TenantConnectionService);
  });

  afterAll(async () => {
    for (const orgId of createdOrgIds) {
      await dataSource.query(
        `DROP SCHEMA IF EXISTS "${schemaNameFor(orgId)}" CASCADE`,
      );
    }
    if (createdOrgIds.length > 0) {
      await dataSource.query(
        `DELETE FROM organization_memberships WHERE "organizationId" = ANY($1)`,
        [createdOrgIds],
      );
      await dataSource.query(`DELETE FROM organizations WHERE id = ANY($1)`, [
        createdOrgIds,
      ]);
    }
    for (const email of createdEmails) {
      await dataSource.query(`DELETE FROM users WHERE email = $1`, [email]);
    }
    await app.close();
  });

  async function registerAndLogin(email: string): Promise<string> {
    createdEmails.push(email);
    await request(app.getHttpServer()).post('/auth/register').send({
      name: 'Test User',
      email,
      password: 'password1',
      confirmPassword: 'password1',
      acceptedTerms: true,
    });

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password1' })
      .expect(200);

    return (loginResponse.body as { accessToken: string }).accessToken;
  }

  async function createOrganization(token: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .put('/organization/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Clinica de prueba',
        description: 'desc',
        address: 'addr',
        contact: 'contact',
      })
      .expect(200);

    const orgId = (response.body as { id: string }).id;
    createdOrgIds.push(orgId);
    return orgId;
  }

  it('provisions a distinct schema per organization', async () => {
    const tokenA = await registerAndLogin(`tenant-a-${Date.now()}@test.com`);
    const orgA = await createOrganization(tokenA);

    const tokenB = await registerAndLogin(`tenant-b-${Date.now()}@test.com`);
    const orgB = await createOrganization(tokenB);

    const rows: Array<{ schema_name: string }> = await dataSource.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = ANY($1)`,
      [[schemaNameFor(orgA), schemaNameFor(orgB)]],
    );

    expect(rows.map((r) => r.schema_name).sort()).toEqual(
      [schemaNameFor(orgA), schemaNameFor(orgB)].sort(),
    );
  });

  it('keeps data written in one tenant schema invisible from another', async () => {
    const tokenA = await registerAndLogin(`tenant-c-${Date.now()}@test.com`);
    const orgA = await createOrganization(tokenA);

    const tokenB = await registerAndLogin(`tenant-d-${Date.now()}@test.com`);
    const orgB = await createOrganization(tokenB);

    const dataSourceA = await tenantConnectionService.getDataSource(orgA);
    const dataSourceB = await tenantConnectionService.getDataSource(orgB);

    await dataSourceA.query(
      `CREATE TABLE IF NOT EXISTS tenant_marker (id serial PRIMARY KEY, value text)`,
    );
    await dataSourceA.query(`INSERT INTO tenant_marker (value) VALUES ($1)`, [
      'only-in-a',
    ]);

    const rowsInA = await dataSourceA.query<Array<{ value: string }>>(
      `SELECT value FROM tenant_marker`,
    );
    expect(rowsInA).toEqual([{ value: 'only-in-a' }]);

    await expect(
      dataSourceB.query(`SELECT value FROM tenant_marker`),
    ).rejects.toThrow();
  });
});
