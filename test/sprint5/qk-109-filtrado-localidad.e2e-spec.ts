/**
 * QK-109 · Filtrado por localidad en el inicio — CP-109-01 a CP-109-09
 * Casos tal como figuran en "DOC TESTEO BACK Sprint 5.pdf" (backend, capa API/DB).
 *
 * Contrato real verificado en `public.controller.ts` / `public.service.ts` /
 * `list-public.query.dto.ts`:
 *   - `/public/*` no lleva guard: sirve sin sesión.
 *   - `listOrganizations`/`listNeeds` solo miran `status = validated`.
 *   - `locality` en `/public/organizations` es IGUALDAD exacta (no ILIKE).
 *
 * Aislamiento entre casos: como `/public/localities` y `/public/organizations`
 * (sin filtro) leen TODA la tabla, cada escenario usa un sufijo único (`TAG`)
 * en sus nombres de localidad para no interferir entre sí dentro del mismo
 * archivo. CP-109-05 (que cuenta el total SIN filtrar) corre inmediatamente
 * después de sembrar el escenario de CP-109-01 y antes de que cualquier otro
 * caso agregue organizaciones nuevas — por eso el orden de los `it` no seguye
 * estrictamente al del documento.
 *
 * CP-109-02 (orden por cantidad desc, alfabético a igualdad) queda
 * documentado como defecto: `listLocalities()` solo ordena
 * `ORDER BY o.locality ASC, o.province ASC` — no cuenta organizaciones ni
 * las usa para ordenar.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { SupplyCategory } from '../../src/modules/supply/entities/supply.entity';
import {
  bootstrapApp,
  cleanupOrganizations,
  cleanupUsers,
  createOrganization,
  createPendingOrg,
  messagesOf,
  registerAndLogin,
  setOrgLocality,
  setOrgStatus,
  switchOrg,
  uniqueEmail,
} from './helpers';

interface PublicLocalityRow {
  locality: string;
  province: string | null;
}
interface PublicOrgRow {
  id: string;
  name: string;
  locality: string | null;
}
interface Page<T> {
  items: T[];
  total: number;
}

describe('QK-109 · Filtrado por localidad en el inicio (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const emails: string[] = [];
  const orgIds: string[] = [];
  const TAG = uniqueEmail('tag').split('@')[0]; // sufijo único para todo el archivo

  function getLocalities() {
    return request(app.getHttpServer()).get('/public/localities');
  }
  function getOrganizations(query: Record<string, string> = {}) {
    return request(app.getHttpServer())
      .get('/public/organizations')
      .query(query);
  }

  async function newValidatedOrg(
    prefix: string,
    name: string,
    locality: string | null,
  ) {
    const email = uniqueEmail(prefix);
    emails.push(email);
    const owner = await registerAndLogin(app, email);
    const org = await createOrganization(app, owner.token, { name });
    orgIds.push(org.id);
    if (locality) await setOrgLocality(dataSource, org.id, locality, 'Córdoba');
    return { ...org, ownerToken: owner.token };
  }

  // Escenario de CP-109-01, reusado por 109-03/05/07/08.
  const VM = `Villa María ${TAG}`;
  const RC = `Río Cuarto ${TAG}`;
  const TP = `Tío Pujio ${TAG}`;
  const LV = `Las Varillas ${TAG}`;
  let pendingOrgId: string;

  beforeAll(async () => {
    ({ app, dataSource } = await bootstrapApp());

    await newValidatedOrg('cp109-vm1', 'Comedor VM 1', VM);
    await newValidatedOrg('cp109-vm2', 'Comedor VM 2', VM);
    await newValidatedOrg('cp109-rc', 'Comedor RC', RC);
    await newValidatedOrg('cp109-null', 'Comedor Sin Localidad', null);

    const pendingEmail = uniqueEmail('cp109-pending');
    emails.push(pendingEmail);
    const pending = await createPendingOrg(app, pendingEmail, {
      name: 'Comedor Pendiente TP',
    });
    orgIds.push(pending.id);
    pendingOrgId = pending.id;
    await setOrgLocality(dataSource, pending.id, TP, 'Córdoba');

    const rejectedEmail = uniqueEmail('cp109-rejected');
    emails.push(rejectedEmail);
    const rejected = await createPendingOrg(app, rejectedEmail, {
      name: 'Comedor Rechazado LV',
    });
    orgIds.push(rejected.id);
    await setOrgLocality(dataSource, rejected.id, LV, 'Córdoba');
    await setOrgStatus(dataSource, rejected.id, 'rejected');
  });

  afterAll(async () => {
    await cleanupOrganizations(dataSource, orgIds);
    await cleanupUsers(dataSource, emails);
    await app.close();
  });

  it('CP-109-01: el listado de localidades ofrece solo las de organizaciones validadas que la cargaron', async () => {
    const res = await getLocalities().expect(200);
    const rows = res.body as PublicLocalityRow[];
    const scenario = rows.filter((r) => r.locality.includes(TAG));

    expect(scenario.map((r) => r.locality).sort()).toEqual([RC, VM].sort());
    expect(scenario.find((r) => r.locality === VM)?.province).toBe('Córdoba');
    expect(rows.some((r) => r.locality === TP)).toBe(false);
    expect(rows.some((r) => r.locality === LV)).toBe(false);
    expect(rows.some((r) => r.locality === null)).toBe(false);
  });

  // Corre acá (no después de 109-02/04/06/09) para que "total" cuente
  // únicamente el escenario recién sembrado, antes de que otros casos
  // agreguen más organizaciones validadas al archivo.
  it('CP-109-05: sin filtro de localidad se listan todas las validadas, incluida la sin localidad, nunca pendientes/rechazadas', async () => {
    const res = await getOrganizations().expect(200);
    const page = res.body as Page<PublicOrgRow>;

    expect(page.total).toBe(4);
    expect(page.items.some((o) => o.locality === null)).toBe(true);
    expect(page.items.some((o) => o.name === 'Comedor Pendiente TP')).toBe(
      false,
    );
    expect(page.items.some((o) => o.name === 'Comedor Rechazado LV')).toBe(
      false,
    );
  });

  it('CP-109-03: filtrar el directorio por una localidad devuelve únicamente esas organizaciones', async () => {
    const res = await getOrganizations({ locality: VM }).expect(200);
    const page = res.body as Page<PublicOrgRow>;

    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(2);
    expect(page.items.every((o) => o.locality === VM)).toBe(true);
  });

  it('CP-109-07: una combinación de filtros sin coincidencias responde una página vacía, sin error', async () => {
    const res = await getOrganizations({ locality: VM, q: 'Río' }).expect(
      200,
    );
    const page = res.body as Page<PublicOrgRow>;
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });

  it('CP-109-08: una organización pendiente con localidad cargada no habilita esa localidad ni aparece al filtrar', async () => {
    const localities = await getLocalities().expect(200);
    expect(
      (localities.body as PublicLocalityRow[]).some((r) => r.locality === TP),
    ).toBe(false);

    const filtered = await getOrganizations({ locality: TP }).expect(200);
    const page = filtered.body as Page<PublicOrgRow>;
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);

    // La organización en cuestión sigue pendiente (no se validó en el medio).
    const row = await dataSource.query(
      `SELECT status FROM organizations WHERE id = $1`,
      [pendingOrgId],
    );
    expect(row[0].status).toBe('pending');
  });

  it('CP-109-02: las localidades se ordenan por cantidad de organizaciones desc y alfabético a igual cantidad', async () => {
    const tag2 = uniqueEmail('tag2').split('@')[0];
    const villaMaria = `Villa María ${tag2}`;
    const arroyito = `Arroyito ${tag2}`;
    const bellVille = `Bell Ville ${tag2}`;
    const localOrgIds: string[] = [];

    for (const [i, name] of ['VM-A', 'VM-B', 'VM-C'].entries()) {
      const org = await newValidatedOrg(`cp109-02-vm${i}`, name, villaMaria);
      localOrgIds.push(org.id);
    }
    const arroyitoOrg = await newValidatedOrg(
      'cp109-02-arroyito',
      'Comedor Arroyito',
      arroyito,
    );
    localOrgIds.push(arroyitoOrg.id);
    const bellVilleOrg = await newValidatedOrg(
      'cp109-02-bellville',
      'Comedor Bell Ville',
      bellVille,
    );
    localOrgIds.push(bellVilleOrg.id);

    const res = await getLocalities().expect(200);
    const rows = (res.body as PublicLocalityRow[]).filter((r) =>
      r.locality.includes(tag2),
    );
    const order = rows.map((r) => r.locality);

    // Resultado DOCUMENTADO (CP-109-02): "Villa María" (3) primero por
    // cantidad, después "Arroyito" y "Bell Ville" (1 c/u) alfabético.
    // Hallazgo: `listLocalities()` no pesa por cantidad, solo ordena
    // alfabético — ver DEF-S5 en el informe. Esta aserción se deja tal
    // como la documenta el caso, a propósito, como evidencia del defecto.
    expect(order).toEqual([villaMaria, arroyito, bellVille]);

    await cleanupOrganizations(dataSource, localOrgIds);
  });

  it('CP-109-04: el filtro de localidad se combina con texto y categoría (las tres condiciones a la vez)', async () => {
    const tag4 = uniqueEmail('tag4').split('@')[0];
    const vm = `Villa María ${tag4}`;
    const rc = `Río Cuarto ${tag4}`;
    const localOrgIds: string[] = [];

    const peques = await newValidatedOrg(
      'cp109-04-peques',
      'Comedor Los Peques',
      vm,
    );
    localOrgIds.push(peques.id);
    const sol = await newValidatedOrg(
      'cp109-04-sol',
      'Merendero Sol',
      vm,
    );
    localOrgIds.push(sol.id);
    const rio = await newValidatedOrg('cp109-04-rio', 'Comedor Río', rc);
    localOrgIds.push(rio.id);

    async function openNeed(ownerToken: string, orgId: string, category: SupplyCategory) {
      const orgToken = await switchOrg(app, ownerToken, orgId);
      const supply = await request(app.getHttpServer())
        .post('/supplies')
        .set('Authorization', `Bearer ${orgToken}`)
        .send({ name: 'Insumo QA', category, unit: 'Kilogramos' })
        .expect(201);
      await request(app.getHttpServer())
        .post('/needs')
        .set('Authorization', `Bearer ${orgToken}`)
        .send({
          supplyId: (supply.body as { id: string }).id,
          requiredQuantity: 10,
          deadline: new Date(Date.now() + 7 * 86400000)
            .toISOString()
            .slice(0, 10),
        })
        .expect(201);
    }

    await openNeed(peques.ownerToken, peques.id, SupplyCategory.ALIMENTOS_SECOS);
    await openNeed(sol.ownerToken, sol.id, SupplyCategory.HIGIENE);
    await openNeed(rio.ownerToken, rio.id, SupplyCategory.ALIMENTOS_SECOS);

    const res = await getOrganizations({
      locality: vm,
      q: 'Comedor',
      category: SupplyCategory.ALIMENTOS_SECOS,
    }).expect(200);
    const page = res.body as Page<PublicOrgRow>;
    expect(page.total).toBe(1);
    expect(page.items[0].name).toBe('Comedor Los Peques');

    await cleanupOrganizations(dataSource, localOrgIds);
  });

  it('CP-109-06: la paginación respeta el filtro de localidad', async () => {
    const tag6 = uniqueEmail('tag6').split('@')[0];
    const vm = `Villa María ${tag6}`;
    const rc = `Río Cuarto ${tag6}`;
    const localOrgIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const org = await newValidatedOrg(`cp109-06-vm${i}`, `VM Org ${i}`, vm);
      localOrgIds.push(org.id);
    }
    for (let i = 0; i < 2; i++) {
      const org = await newValidatedOrg(`cp109-06-rc${i}`, `RC Org ${i}`, rc);
      localOrgIds.push(org.id);
    }

    const page1 = await getOrganizations({
      locality: vm,
      pageSize: '2',
      page: '1',
    }).expect(200);
    const body1 = page1.body as Page<PublicOrgRow>;
    expect(body1.items).toHaveLength(2);
    expect(body1.total).toBe(3);

    const page2 = await getOrganizations({
      locality: vm,
      pageSize: '2',
      page: '2',
    }).expect(200);
    const body2 = page2.body as Page<PublicOrgRow>;
    expect(body2.items).toHaveLength(1);
    expect(body2.total).toBe(3);

    const ids1 = body1.items.map((o) => o.id);
    const ids2 = body2.items.map((o) => o.id);
    expect(ids1.some((id) => ids2.includes(id))).toBe(false);
    expect([...ids1, ...ids2].every((id) => id)).toBe(true);
    expect(
      [...body1.items, ...body2.items].every((o) => o.locality === vm),
    ).toBe(true);

    await cleanupOrganizations(dataSource, localOrgIds);
  });

  it('CP-109-09: valida la longitud del parámetro de localidad en el directorio público', async () => {
    const res = await getOrganizations({ locality: 'x'.repeat(121) }).expect(
      400,
    );
    expect(messagesOf(res.body).length).toBeGreaterThan(0);
  });
});
