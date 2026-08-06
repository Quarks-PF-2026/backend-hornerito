import 'dotenv/config';
import { DataSource } from 'typeorm';
import { Media } from '../modules/media/entities/media.entity';
import { Need } from '../modules/need/entities/need.entity';
import { OrganizationStatus } from '../modules/organization/entities/organization.entity';
import { Supply } from '../modules/supply/entities/supply.entity';
import { TENANT_ENTITIES } from '../modules/tenant/tenant-entities';
import { schemaNameFor } from '../modules/tenant/tenant-schema.util';
import { AppDataSource } from './data-source';
import { createTenantDataSource } from './tenant-data-source';

/**
 * Reconstruye el directorio público (`public_needs` + logo/portada en
 * `organizations`) leyendo los schemas de cada organización, que son la fuente
 * de verdad. Sirve como backfill inicial y como reparación si algún write
 * dejó el espejo desincronizado.
 */
async function main(): Promise<void> {
  await AppDataSource.initialize();

  const organizations: Array<{ id: string }> = await AppDataSource.query(
    `SELECT id FROM "public"."organizations" WHERE status = $1`,
    [OrganizationStatus.VALIDATED],
  );

  let mirroredNeeds = 0;

  for (const { id } of organizations) {
    const tenant = createTenantDataSource({
      schema: schemaNameFor(id),
      entities: TENANT_ENTITIES,
      poolSize: 1,
    });

    try {
      await tenant.initialize();
    } catch (error) {
      console.warn(`Saltando ${id}: no se pudo abrir su schema. ${String(error)}`);
      continue;
    }

    try {
      const [needs, supplies, media] = await Promise.all([
        tenant.getRepository(Need).find(),
        tenant.getRepository(Supply).find(),
        tenant.getRepository(Media).findBy({ ownerType: 'organization' }),
      ]);
      const supplyById = new Map(supplies.map((supply) => [supply.id, supply]));

      await AppDataSource.query(
        `DELETE FROM "public"."public_needs" WHERE "organizationId" = $1`,
        [id],
      );

      for (const need of needs) {
        const supply = supplyById.get(need.supplyId);
        if (!supply) {
          continue;
        }
        await AppDataSource.query(
          `INSERT INTO "public"."public_needs"
             ("id", "organizationId", "supplyId", "supplyName", "supplyCategory",
              "supplyUnit", "requiredQuantity", "coveredQuantity", "deadline", "closed")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            need.id,
            id,
            supply.id,
            supply.name,
            supply.category,
            supply.unit,
            need.requiredQuantity,
            need.coveredQuantity,
            need.deadline,
            need.closedManually ||
              need.coveredQuantity >= need.requiredQuantity,
          ],
        );
        mirroredNeeds += 1;
      }

      await AppDataSource.query(
        `UPDATE "public"."organizations" SET "logoUrl" = $2, "coverUrl" = $3 WHERE id = $1`,
        [
          id,
          media.find((item) => item.purpose === 'logo')?.url ?? null,
          media.find((item) => item.purpose === 'cover')?.url ?? null,
        ],
      );
    } finally {
      await tenant.destroy().catch(() => undefined);
    }
  }

  await AppDataSource.destroy();
  console.log(
    `Directorio público reconstruido: ${organizations.length} organización(es), ${mirroredNeeds} necesidad(es).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
