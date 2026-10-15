/**
 * QK-108 · Ver necesidades por vencer — CP-108-01 a CP-108-08
 * Casos tal como figuran en "DOC TESTEO BACK Sprint 5.pdf" (backend, capa API/DB).
 *
 * Contrato real verificado en `public.controller.ts` / `public.service.ts` /
 * `list-public.query.dto.ts` / `need.service.ts`:
 *   - `GET /public/needs?withinDays=N` es público (sin guard), filtra
 *     `n.deadline BETWEEN hoy AND hoy + N` (SQL) sobre necesidades abiertas
 *     (`OPEN_NEED`) de organizaciones `validated`.
 *   - `NeedService.create/update` rechazan un `deadline` anterior a hoy
 *     (`assertDeadlineNotPast`): para sembrar una necesidad YA vencida
 *     (CP-108-03) hace falta backdatear por SQL después de crearla.
 *   - El filtro `q` matchea `supply.name ILIKE` u `organization.name ILIKE`:
 *     se usa como mecanismo de aislamiento entre casos (ver helper `tag`),
 *     porque `/public/needs` lee toda la tabla sin acotar por organización.
 *
 * CP-108-02 (límite superior de la ventana) queda documentado como defecto:
 * el `BETWEEN` SQL es inclusive en ambos extremos, así que `hoy+withinDays`
 * SÍ entra, contra lo que documenta el caso ("hoy+7 ya no entra" con
 * withinDays=7).
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { SupplyCategory, SupplyUnit } from '../../src/modules/supply/entities/supply.entity';
import {
  addDays,
  backdateNeedDeadline,
  bootstrapApp,
  cleanupOrganizations,
  cleanupUsers,
  createOrganization,
  messagesOf,
  registerAndLogin,
  setOrgStatus,
  switchOrg,
  today,
  uniqueEmail,
} from './helpers';

interface PublicNeedRow {
  id: string;
  organizationId: string;
  organizationName: string;
  organizationLogoUrl: string | null;
  deadline: string;
}
interface Page<T> {
  items: T[];
  total: number;
}

describe('QK-108 · Ver necesidades por vencer (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const emails: string[] = [];
  const orgIds: string[] = [];

  function listNeeds(query: Record<string, string>) {
    return request(app.getHttpServer()).get('/public/needs').query(query);
  }

  /** Org validada + 1 insumo, lista para publicar necesidades. Nombre con `tag` para aislar la query por `q`. */
  async function newOrgWithSupply(prefix: string, tag: string) {
    const email = uniqueEmail(prefix);
    emails.push(email);
    const owner = await registerAndLogin(app, email);
    const org = await createOrganization(app, owner.token, {
      name: `Comedor ${tag}`,
    });
    orgIds.push(org.id);
    const orgToken = await switchOrg(app, owner.token, org.id);
    const supply = await request(app.getHttpServer())
      .post('/supplies')
      .set('Authorization', `Bearer ${orgToken}`)
      .send({ name: `Insumo ${tag}`, category: SupplyCategory.ALIMENTOS_SECOS, unit: SupplyUnit.KILOGRAMOS })
      .expect(201);
    return {
      orgId: org.id,
      orgToken,
      supplyId: (supply.body as { id: string }).id,
    };
  }

  async function openNeed(
    orgToken: string,
    supplyId: string,
    deadline: string,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/needs')
      .set('Authorization', `Bearer ${orgToken}`)
      .send({ supplyId, requiredQuantity: 10, deadline })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  function tagOf(prefix: string): string {
    return uniqueEmail(prefix).split('@')[0];
  }

  beforeAll(async () => {
    ({ app, dataSource } = await bootstrapApp());
  });

  afterAll(async () => {
    await cleanupOrganizations(dataSource, orgIds);
    await cleanupUsers(dataSource, emails);
    await app.close();
  });

  it('CP-108-01: devuelve las necesidades abiertas dentro de la ventana, ordenadas por deadline ascendente', async () => {
    const tag = tagOf('cp108-01');
    const { orgToken, supplyId } = await newOrgWithSupply('cp108-01', tag);
    await openNeed(orgToken, supplyId, today());
    await openNeed(orgToken, supplyId, addDays(today(), 3));
    await openNeed(orgToken, supplyId, addDays(today(), 6));

    const res = await listNeeds({ withinDays: '7', q: tag }).expect(200);
    const page = res.body as Page<PublicNeedRow>;
    expect(page.items).toHaveLength(3);
    expect(page.items.map((i) => i.deadline)).toEqual([
      today(),
      addDays(today(), 3),
      addDays(today(), 6),
    ]);
    for (const item of page.items) {
      expect(item).toEqual(
        expect.objectContaining({
          organizationId: expect.any(String),
          organizationName: expect.any(String),
          organizationLogoUrl: null,
          deadline: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      );
    }
  });

  it('CP-108-02: con 7 días contando hoy, una necesidad que vence en hoy+7 ya no entra', async () => {
    const tag = tagOf('cp108-02');
    const { orgToken, supplyId } = await newOrgWithSupply('cp108-02', tag);
    await openNeed(orgToken, supplyId, addDays(today(), 6));
    await openNeed(orgToken, supplyId, addDays(today(), 7));
    await openNeed(orgToken, supplyId, addDays(today(), 30));

    const res = await listNeeds({ withinDays: '7', q: tag }).expect(200);
    const page = res.body as Page<PublicNeedRow>;
    const deadlines = page.items.map((i) => i.deadline);

    // Resultado DOCUMENTADO: solo hoy+6. Hallazgo: el `BETWEEN` SQL incluye
    // también hoy+7 (ver header) — se deja la aserción tal como la
    // documenta el caso, a propósito, como evidencia del defecto.
    expect(deadlines).toEqual([addDays(today(), 6)]);
  });

  it('CP-108-03: una necesidad ya vencida no se muestra aunque siga abierta', async () => {
    const tag = tagOf('cp108-03');
    const { orgToken, supplyId } = await newOrgWithSupply('cp108-03', tag);
    const expiredId = await openNeed(orgToken, supplyId, today());
    await backdateNeedDeadline(dataSource, expiredId, addDays(today(), -1));
    await openNeed(orgToken, supplyId, today());

    const res = await listNeeds({ withinDays: '7', q: tag }).expect(200);
    const page = res.body as Page<PublicNeedRow>;
    expect(page.items).toHaveLength(1);
    expect(page.items[0].deadline).toBe(today());
  });

  it('CP-108-04: con más necesidades por vencer que el tope se devuelven las que vencen primero', async () => {
    const tag = tagOf('cp108-04');
    const { orgToken, supplyId } = await newOrgWithSupply('cp108-04', tag);
    for (let i = 0; i < 15; i++) {
      await openNeed(orgToken, supplyId, addDays(today(), i % 7));
    }

    const res = await listNeeds({
      withinDays: '7',
      pageSize: '12',
      q: tag,
    }).expect(200);
    const page = res.body as Page<PublicNeedRow>;
    expect(page.items).toHaveLength(12);
    expect(page.total).toBe(15);
    const deadlines = page.items.map((i) => i.deadline);
    expect(deadlines).toEqual([...deadlines].sort());
  });

  it('CP-108-05: una necesidad cubierta o cerrada a mano deja de aparecer entre las que están por vencer', async () => {
    const tag = tagOf('cp108-05');
    const { orgToken, supplyId } = await newOrgWithSupply('cp108-05', tag);
    const deadline = addDays(today(), 2);

    await openNeed(orgToken, supplyId, deadline);
    const coveredId = await openNeed(orgToken, supplyId, deadline);
    await request(app.getHttpServer())
      .patch(`/needs/${coveredId}/progress`)
      .set('Authorization', `Bearer ${orgToken}`)
      .send({ coveredQuantity: 10 })
      .expect(200);
    const closedId = await openNeed(orgToken, supplyId, deadline);
    await request(app.getHttpServer())
      .patch(`/needs/${closedId}/close`)
      .set('Authorization', `Bearer ${orgToken}`)
      .expect(200);

    const res = await listNeeds({ withinDays: '7', q: tag }).expect(200);
    const page = res.body as Page<PublicNeedRow>;
    expect(page.items).toHaveLength(1);
  });

  it('CP-108-06: el endpoint es público y solo devuelve necesidades de organizaciones validadas', async () => {
    const tag = tagOf('cp108-06');
    const validated = await newOrgWithSupply('cp108-06-validada', tag);
    await openNeed(validated.orgToken, validated.supplyId, addDays(today(), 1));

    const pending = await newOrgWithSupply('cp108-06-pendiente', tag);
    await openNeed(pending.orgToken, pending.supplyId, addDays(today(), 1));
    await setOrgStatus(dataSource, pending.orgId, 'pending');

    const res = await listNeeds({ withinDays: '7', q: tag }).expect(200);
    const page = res.body as Page<PublicNeedRow>;
    expect(page.items).toHaveLength(1);
    expect(page.items[0].organizationId).toBe(validated.orgId);
  });

  it('CP-108-07: sin el parámetro de vencimiento el feed público se comporta igual que antes del cambio', async () => {
    const tag = tagOf('cp108-07');
    const { orgToken, supplyId } = await newOrgWithSupply('cp108-07', tag);
    await openNeed(orgToken, supplyId, addDays(today(), 2));
    await openNeed(orgToken, supplyId, addDays(today(), 30));

    const res = await listNeeds({ q: tag }).expect(200);
    const page = res.body as Page<PublicNeedRow>;
    expect(page.items).toHaveLength(2);
    expect(page.items.map((i) => i.deadline)).toEqual([
      addDays(today(), 2),
      addDays(today(), 30),
    ]);
  });

  it('CP-108-08: valida el parámetro de vencimiento (entero entre 1 y 30)', async () => {
    for (const invalid of ['0', '31', '-1', '2.5', 'abc']) {
      const res = await listNeeds({ withinDays: invalid }).expect(400);
      expect(messagesOf(res.body).length).toBeGreaterThan(0);
    }
  });
});
