import { MigrationInterface, QueryRunner } from 'typeorm';

const APP_ROLE = 'hornerito_app';

/** Igual que en ColumnBasedTenancy: sin la variable seteada no se ve nada. */
const CURRENT_ORG = `NULLIF(current_setting('app.current_org', true), '')::uuid`;

/** Espeja DEFAULT_VOLUNTEER_TYPES de la entidad. */
const DEFAULTS = [
  'Cocina',
  'Reparto',
  'Logística',
  'Limpieza',
  'Apoyo escolar',
];

/**
 * Administrar Tipo de Voluntario (QK-33): catálogo por organización, mismo
 * molde que `supplies`. La oportunidad apunta a un tipo con una FK compuesta
 * `(organizationId, volunteerTypeId)` para que no pueda referenciar el
 * catálogo de otra organización.
 *
 * La FK va sin `ON DELETE SET NULL`: en una FK compuesta Postgres anularía
 * también `organizationId`, que es NOT NULL. No hace falta, porque los tipos
 * se dan de baja lógicamente (`active`), nunca se borran.
 */
export class AddVolunteerTypes1786300000000 implements MigrationInterface {
  name = 'AddVolunteerTypes1786300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "volunteer_types" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "name" character varying NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_volunteer_types" PRIMARY KEY ("id"),
        CONSTRAINT "FK_volunteer_types_organization" FOREIGN KEY ("organizationId")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_volunteer_types_org_id" UNIQUE ("organizationId", "id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "volunteer_opportunities" ADD COLUMN "volunteerTypeId" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "volunteer_opportunities"
        ADD CONSTRAINT "FK_volunteer_opportunities_type"
        FOREIGN KEY ("organizationId", "volunteerTypeId")
        REFERENCES "volunteer_types" ("organizationId", "id")
    `);

    // Siembra de las organizaciones que ya existen; las nuevas las crea
    // OrganizationService.createMine.
    const values = DEFAULTS.map((name) => `('${name}')`).join(',');
    await queryRunner.query(`
      INSERT INTO "volunteer_types" ("organizationId", "name")
      SELECT o."id", t."name"
      FROM "organizations" o
      CROSS JOIN (VALUES ${values}) AS t("name")
    `);

    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON "volunteer_types" TO "${APP_ROLE}"
    `);
    await queryRunner.query(
      `ALTER TABLE "volunteer_types" ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON "volunteer_types"
        USING      ("organizationId" = ${CURRENT_ORG})
        WITH CHECK ("organizationId" = ${CURRENT_ORG})
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "volunteer_opportunities"
        DROP CONSTRAINT IF EXISTS "FK_volunteer_opportunities_type"
    `);
    await queryRunner.query(`
      ALTER TABLE "volunteer_opportunities" DROP COLUMN IF EXISTS "volunteerTypeId"
    `);

    await queryRunner.query(
      `DROP POLICY IF EXISTS "tenant_isolation" ON "volunteer_types"`,
    );
    await queryRunner.query(
      `REVOKE ALL ON "volunteer_types" FROM "${APP_ROLE}"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "volunteer_types"`);
  }
}
