import { MigrationInterface, QueryRunner } from 'typeorm';

const APP_ROLE = 'hornerito_app';

/** Igual que en ColumnBasedTenancy: sin la variable seteada no se ve nada. */
const CURRENT_ORG = `NULLIF(current_setting('app.current_org', true), '')::uuid`;

const TABLES = ['events', 'event_attendances'];

/**
 * Gestionar Eventos (QK-117) y Registrar Asistencia (QK-116).
 *
 * Las ocurrencias son virtuales: una ocurrencia es el par (evento, fecha) y se
 * deriva de `kind` + `startDate` + `endedOn` (periódico = diario hasta hoy o
 * hasta la baja; extraordinario = solo `startDate`). Lo único que se persiste
 * es el conteo, en `event_attendances`, una fila por (evento, fecha). Así no
 * hay que generar ni limpiar filas por cada día, a costa de que "qué días
 * existen" sea lógica del service y no del esquema.
 *
 * `kind` es un enum de Postgres, como los `status` del resto del esquema.
 *
 * No hay CHECK `endedOn >= startDate`: un extraordinario futuro dado de baja
 * hoy lo violaría. La regla de qué `endedOn` escribir vive en el service.
 *
 * La asistencia apunta al evento con FK compuesta `(organizationId, eventId)`
 * para que no pueda colgar de un evento de otra organización. Va sin
 * `ON DELETE`: en una FK compuesta `SET NULL` anularía también
 * `organizationId`, y `CASCADE` borraría conteos históricos. Los eventos se
 * dan de baja lógicamente (`active` + `endedOn`), nunca se borran; borrar la
 * organización sí arrastra todo por las FKs a `organizations`.
 *
 * `UQ_event_attendances_event_date` es el target del upsert `ON CONFLICT`:
 * registrar dos veces el mismo día corrige el conteo, no lo duplica.
 */
export class AddEventsAndAttendance1786900000000 implements MigrationInterface {
  name = 'AddEventsAndAttendance1786900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "events_kind_enum" AS ENUM ('periodic', 'one_off')
    `);

    await queryRunner.query(`
      CREATE TABLE "events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "name" character varying NOT NULL,
        "kind" "events_kind_enum" NOT NULL,
        "startDate" date NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "endedOn" date,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_events_organization" FOREIGN KEY ("organizationId")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_events_org_id" UNIQUE ("organizationId", "id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "event_attendances" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "eventId" uuid NOT NULL,
        "date" date NOT NULL,
        "count" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_event_attendances" PRIMARY KEY ("id"),
        CONSTRAINT "FK_event_attendances_organization" FOREIGN KEY ("organizationId")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_event_attendances_event" FOREIGN KEY ("organizationId", "eventId")
          REFERENCES "events" ("organizationId", "id"),
        CONSTRAINT "UQ_event_attendances_event_date" UNIQUE ("eventId", "date"),
        CONSTRAINT "CHK_event_attendances_count" CHECK ("count" >= 0)
      )
    `);

    for (const table of TABLES) {
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
    for (const table of [...TABLES].reverse()) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS "tenant_isolation" ON "${table}"`,
      );
      await queryRunner.query(`REVOKE ALL ON "${table}" FROM "${APP_ROLE}"`);
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }
    await queryRunner.query(`DROP TYPE IF EXISTS "events_kind_enum"`);
  }
}
