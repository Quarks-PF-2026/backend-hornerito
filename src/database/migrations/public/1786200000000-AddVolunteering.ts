import { MigrationInterface, QueryRunner } from 'typeorm';

const APP_ROLE = 'hornerito_app';

/** Igual que en ColumnBasedTenancy: sin la variable seteada no se ve nada. */
const CURRENT_ORG = `NULLIF(current_setting('app.current_org', true), '')::uuid`;

const RLS_TABLES = ['volunteer_opportunities', 'volunteer_applications'];

/**
 * Gestionar Voluntariado (QK-24): la organización publica actividades con
 * cupos y resuelve las postulaciones de sus miembros.
 *
 * El cupo se consume al aceptar, no al postularse, así que `acceptedCount`
 * vive en la oportunidad y el "cupo lleno" se deriva — no hay un estado
 * persistido para eso (ver `isOpportunityOpen`).
 */
export class AddVolunteering1786200000000 implements MigrationInterface {
  name = 'AddVolunteering1786200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "volunteer_opportunities_status_enum"
        AS ENUM ('open', 'closed', 'cancelled')
    `);
    await queryRunner.query(`
      CREATE TYPE "volunteer_applications_status_enum"
        AS ENUM ('pending', 'accepted', 'rejected')
    `);

    await queryRunner.query(`
      CREATE TABLE "volunteer_opportunities" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "title" character varying NOT NULL,
        "description" text NOT NULL,
        "startsAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "location" character varying NOT NULL,
        "capacity" integer NOT NULL,
        "acceptedCount" integer NOT NULL DEFAULT 0,
        "status" "volunteer_opportunities_status_enum" NOT NULL DEFAULT 'open',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_volunteer_opportunities" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_volunteer_opportunities_capacity" CHECK ("capacity" > 0),
        CONSTRAINT "CHK_volunteer_opportunities_accepted" CHECK ("acceptedCount" >= 0 AND "acceptedCount" <= "capacity"),
        CONSTRAINT "FK_volunteer_opportunities_organization" FOREIGN KEY ("organizationId")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_volunteer_opportunities_org_id" UNIQUE ("organizationId", "id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_volunteer_opportunities_org_startsAt"
        ON "volunteer_opportunities" ("organizationId", "startsAt")
    `);

    await queryRunner.query(`
      CREATE TABLE "volunteer_applications" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "opportunityId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "status" "volunteer_applications_status_enum" NOT NULL DEFAULT 'pending',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "decidedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_volunteer_applications" PRIMARY KEY ("id"),
        CONSTRAINT "FK_volunteer_applications_organization" FOREIGN KEY ("organizationId")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_volunteer_applications_opportunity" FOREIGN KEY ("organizationId", "opportunityId")
          REFERENCES "volunteer_opportunities" ("organizationId", "id") ON DELETE CASCADE,
        CONSTRAINT "FK_volunteer_applications_user" FOREIGN KEY ("userId")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_volunteer_applications_opportunity_user" UNIQUE ("opportunityId", "userId")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_volunteer_applications_org_opportunity"
        ON "volunteer_applications" ("organizationId", "opportunityId", "status")
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

    await queryRunner.query(
      `DROP TYPE IF EXISTS "volunteer_applications_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "volunteer_opportunities_status_enum"`,
    );
  }
}
