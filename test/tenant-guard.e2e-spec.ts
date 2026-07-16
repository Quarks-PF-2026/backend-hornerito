import {
  Controller,
  Get,
  INestApplication,
  Module,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { OrganizationStatus } from '../src/modules/organization/entities/organization.entity';
import { TenantGuard } from '../src/modules/tenant/tenant.guard';
import { TenantModule } from '../src/modules/tenant/tenant.module';
import { schemaNameFor } from '../src/modules/tenant/tenant-schema.util';

@Controller('tenant-probe')
class TenantProbeController {
  @Get()
  @UseGuards(JwtAuthGuard, TenantGuard)
  ping() {
    return { ok: true };
  }
}

@Module({ imports: [TenantModule], controllers: [TenantProbeController] })
class TenantProbeModule {}

describe('TenantGuard (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let jwtService: JwtService;
  const createdOrgIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule, TenantProbeModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    dataSource = app.get(DataSource);
    jwtService = app.get(JwtService);
  });

  afterAll(async () => {
    for (const orgId of createdOrgIds) {
      await dataSource.query(
        `DROP SCHEMA IF EXISTS "${schemaNameFor(orgId)}" CASCADE`,
      );
    }
    if (createdOrgIds.length > 0) {
      await dataSource.query(`DELETE FROM organizations WHERE id = ANY($1)`, [
        createdOrgIds,
      ]);
    }
    await app.close();
  });

  async function makeOrganization(status: OrganizationStatus): Promise<string> {
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO organizations ("ownerId", name, description, address, contact, status)
       VALUES ($1, 'x', 'x', 'x', 'x', $2) RETURNING id`,
      ['00000000-0000-0000-0000-000000000000', status],
    );
    const orgId = rows[0].id;
    createdOrgIds.push(orgId);
    return orgId;
  }

  it('rejects a token without orgId', async () => {
    const token = jwtService.sign({ sub: 'user-1', email: 'x@test.com' });
    await request(app.getHttpServer())
      .get('/tenant-probe')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('rejects a token pointing to a pending organization', async () => {
    const orgId = await makeOrganization(OrganizationStatus.PENDING);
    const token = jwtService.sign({
      sub: 'user-1',
      email: 'x@test.com',
      orgId,
    });
    await request(app.getHttpServer())
      .get('/tenant-probe')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('rejects a token pointing to a rejected organization', async () => {
    const orgId = await makeOrganization(OrganizationStatus.REJECTED);
    const token = jwtService.sign({
      sub: 'user-1',
      email: 'x@test.com',
      orgId,
    });
    await request(app.getHttpServer())
      .get('/tenant-probe')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('allows a token pointing to a validated organization', async () => {
    const orgId = await makeOrganization(OrganizationStatus.VALIDATED);
    const token = jwtService.sign({
      sub: 'user-1',
      email: 'x@test.com',
      orgId,
    });
    await request(app.getHttpServer())
      .get('/tenant-probe')
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { ok: true });
  });
});
