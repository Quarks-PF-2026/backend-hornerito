import { MigrationInterface, QueryRunner } from 'typeorm';

const APP_ROLE = 'hornerito_app';

/** Igual que en ColumnBasedTenancy: sin la variable seteada no se ve nada. */
const CURRENT_ORG = `NULLIF(current_setting('app.current_org', true), '')::uuid`;

const RLS_TABLES = ['donations', 'donation_items'];

/**
 * Donación presencial (QK-26): la organización registra lo que recibe.
 *
 * `needs` y `collection_points` no tenían el UNIQUE compuesto que necesitan
 * las FK de `donation_items` y `donations`, así que se agrega acá.
 */
export class AddDonations1786100000000 implements MigrationInterface {
  name = 'AddDonations1786100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "collection_points"
        ADD CONSTRAINT "UQ_collection_points_org_id" UNIQUE ("organizationId", "id")
    `);
    await queryRunner.query(`
      ALTER TABLE "needs"
        ADD CONSTRAINT "UQ_needs_org_id" UNIQUE ("organizationId", "id")
    `);

    await queryRunner.query(`
      CREATE TABLE "donations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "collectionPointId" uuid,
        "donorName" character varying(80),
        "donorContact" character varying(120),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_donations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_donations_organization" FOREIGN KEY ("organizationId")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_donations_collection_point" FOREIGN KEY ("organizationId", "collectionPointId")
          REFERENCES "collection_points" ("organizationId", "id") ON DELETE CASCADE,
        CONSTRAINT "UQ_donations_org_id" UNIQUE ("organizationId", "id")
      )
    `);
    // El historial se lista de la más nueva a la más vieja.
    await queryRunner.query(`
      CREATE INDEX "IDX_donations_org_createdAt"
        ON "donations" ("organizationId", "createdAt" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE "donation_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "donationId" uuid NOT NULL,
        "supplyId" uuid NOT NULL,
        "needId" uuid,
        "quantity" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_donation_items" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_donation_items_quantity" CHECK ("quantity" > 0),
        CONSTRAINT "FK_donation_items_organization" FOREIGN KEY ("organizationId")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_donation_items_donation" FOREIGN KEY ("organizationId", "donationId")
          REFERENCES "donations" ("organizationId", "id") ON DELETE CASCADE,
        CONSTRAINT "FK_donation_items_supply" FOREIGN KEY ("organizationId", "supplyId")
          REFERENCES "supplies" ("organizationId", "id") ON DELETE CASCADE,
        CONSTRAINT "FK_donation_items_need" FOREIGN KEY ("organizationId", "needId")
          REFERENCES "needs" ("organizationId", "id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_donation_items_org_donation"
        ON "donation_items" ("organizationId", "donationId")
    `);

    for (const table of RLS_TABLES) {
      await queryRunner.query(`
        GRANT SELECT, INSERT, UPDATE, DELETE ON "${table}" TO "${APP_ROLE}"
      `);
      await queryRunner.query(
        `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`,
      );
      await queryRunner.query(`
        CREATE POLICY "tenant_isolation" ON "${table}"
          USING      ("organizationId" = ${CURRENT_ORG})
          WITH CHECK ("organizationId" = ${CURRENT_ORG})
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [...RLS_TABLES].reverse()) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS "tenant_isolation" ON "${table}"`,
      );
      await queryRunner.query(`REVOKE ALL ON "${table}" FROM "${APP_ROLE}"`);
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }

    await queryRunner.query(`
      ALTER TABLE "needs" DROP CONSTRAINT IF EXISTS "UQ_needs_org_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "collection_points"
        DROP CONSTRAINT IF EXISTS "UQ_collection_points_org_id"
    `);
  }
}
