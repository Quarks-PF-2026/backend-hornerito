import { MigrationInterface, QueryRunner } from 'typeorm';

const APP_ROLE = 'hornerito_app';

/** Igual que en ColumnBasedTenancy: sin la variable seteada no se ve nada. */
const CURRENT_ORG = `NULLIF(current_setting('app.current_org', true), '')::uuid`;

/**
 * Validar Voluntario (QK-16): una persona sin cuenta se ofrece desde la ficha
 * pública y la organización aprueba o rechaza antes de que entre.
 *
 * Sobre la RLS de esta tabla, que es la parte no obvia: el INSERT lo hace un
 * visitante anónimo, por una conexión que nunca hizo `SET ROLE`. Corre como
 * owner de la base, y en Postgres el owner NO está sujeto a RLS salvo que la
 * tabla tenga `FORCE ROW LEVEL SECURITY`. Por eso la policy no lo bloquea, y
 * por eso NO hay que agregar `FORCE`: rompería la vía anónima.
 *
 * El aislamiento del insert lo garantiza `VolunteerRequestService.submit`, que
 * resuelve el `organizationId` desde la organización `validated` de la URL y
 * valida la oportunidad y el tipo contra esa misma organización antes de
 * escribir. Misma postura que ya tiene `PublicService` para leer entre
 * organizaciones (CLAUDE.md §6: RLS es la red de seguridad, no el filtro).
 * La policy sí gobierna al panel, que entra por `hornerito_app`.
 */
export class AddVolunteerRequests1786400000000 implements MigrationInterface {
  name = 'AddVolunteerRequests1786400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "volunteer_requests_status_enum"
        AS ENUM ('pending', 'approved', 'rejected')
    `);

    await queryRunner.query(`
      CREATE TABLE "volunteer_requests" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "opportunityId" uuid,
        "volunteerTypeId" uuid,
        "name" character varying NOT NULL,
        "email" character varying NOT NULL,
        "phone" character varying,
        "message" text,
        "status" "volunteer_requests_status_enum" NOT NULL DEFAULT 'pending',
        "rejectReason" character varying,
        "invitationId" uuid,
        "decidedByUserId" uuid,
        "decidedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_volunteer_requests" PRIMARY KEY ("id"),
        CONSTRAINT "FK_volunteer_requests_organization" FOREIGN KEY ("organizationId")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_volunteer_requests_opportunity" FOREIGN KEY ("organizationId", "opportunityId")
          REFERENCES "volunteer_opportunities" ("organizationId", "id") ON DELETE CASCADE,
        CONSTRAINT "FK_volunteer_requests_type" FOREIGN KEY ("organizationId", "volunteerTypeId")
          REFERENCES "volunteer_types" ("organizationId", "id"),
        CONSTRAINT "FK_volunteer_requests_decided_by" FOREIGN KEY ("decidedByUserId")
          REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_volunteer_requests_invitation" FOREIGN KEY ("invitationId")
          REFERENCES "organization_invitations" ("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_volunteer_requests_reject_reason"
          CHECK ("status" <> 'rejected' OR "rejectReason" IS NOT NULL),
        CONSTRAINT "CHK_volunteer_requests_target"
          CHECK ("opportunityId" IS NULL OR "volunteerTypeId" IS NULL)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_volunteer_requests_org_status"
        ON "volunteer_requests" ("organizationId", "status", "createdAt")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_volunteer_requests_org_opportunity"
        ON "volunteer_requests" ("organizationId", "opportunityId")
    `);

    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON "volunteer_requests" TO "${APP_ROLE}"
    `);
    await queryRunner.query(
      `ALTER TABLE "volunteer_requests" ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON "volunteer_requests"
        USING      ("organizationId" = ${CURRENT_ORG})
        WITH CHECK ("organizationId" = ${CURRENT_ORG})
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP POLICY IF EXISTS "tenant_isolation" ON "volunteer_requests"`,
    );
    await queryRunner.query(
      `REVOKE ALL ON "volunteer_requests" FROM "${APP_ROLE}"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "volunteer_requests"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "volunteer_requests_status_enum"`,
    );
  }
}
