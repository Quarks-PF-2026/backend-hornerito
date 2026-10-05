import { MigrationInterface, QueryRunner } from 'typeorm';

const TABLES = [
  { table: 'needs', short: 'needs' },
  { table: 'volunteer_opportunities', short: 'volunteer_opportunities' },
];

/**
 * Asociar necesidades y actividades de voluntariado a un evento. Una sola
 * columna opcional `eventId` por tabla (a lo sumo un evento).
 *
 * Mismo molde que `volunteerTypeId`: FK compuesta `(organizationId, eventId)`
 * contra `UQ_events_org_id`, para que no pueda apuntar a un evento de otra
 * organización. Sin `ON DELETE`: los eventos se dan de baja lógicamente, nunca
 * se borran, y `SET NULL` anularía también `organizationId` (NOT NULL).
 */
export class LinkNeedsAndOpportunitiesToEvents1787200000000 implements MigrationInterface {
  name = 'LinkNeedsAndOpportunitiesToEvents1787200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const { table, short } of TABLES) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN "eventId" uuid`,
      );
      await queryRunner.query(`
        ALTER TABLE "${table}"
          ADD CONSTRAINT "FK_${short}_event"
          FOREIGN KEY ("organizationId", "eventId")
          REFERENCES "events" ("organizationId", "id")
      `);
      await queryRunner.query(`
        CREATE INDEX "IDX_${short}_org_event" ON "${table}" ("organizationId", "eventId")
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const { table, short } of [...TABLES].reverse()) {
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_${short}_org_event"`);
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "FK_${short}_event"`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP COLUMN IF EXISTS "eventId"`,
      );
    }
  }
}
