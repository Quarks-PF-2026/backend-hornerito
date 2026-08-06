import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Directorio público. Las necesidades viven en el schema de cada organización,
 * así que un feed global no se puede consultar con una sola query: esta tabla
 * es un espejo denormalizado en `public`, escrito desde los writes del tenant
 * y reconstruible con `npm run mirror:rebuild`.
 *
 * Las URLs de logo/portada se copian a `organizations` por el mismo motivo:
 * `media` es una tabla del tenant y el listado público no puede abrir una
 * conexión por organización solo para pintar el avatar.
 */
export class AddPublicDirectory1785000000000 implements MigrationInterface {
  name = 'AddPublicDirectory1785000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "public"."organizations"
        ADD COLUMN "logoUrl" text NULL,
        ADD COLUMN "coverUrl" text NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "public"."public_needs" (
        "id" uuid NOT NULL,
        "organizationId" uuid NOT NULL,
        "supplyId" uuid NOT NULL,
        "supplyName" text NOT NULL,
        "supplyCategory" text NOT NULL,
        "supplyUnit" text NOT NULL,
        "requiredQuantity" integer NOT NULL,
        "coveredQuantity" integer NOT NULL DEFAULT 0,
        "deadline" date NOT NULL,
        "closed" boolean NOT NULL DEFAULT false,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_public_needs" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_public_needs_org" ON "public"."public_needs" ("organizationId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_public_needs_open" ON "public"."public_needs" ("closed", "supplyCategory")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_public_needs_supply" ON "public"."public_needs" ("supplyId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "public"."public_needs"`);
    await queryRunner.query(`
      ALTER TABLE "public"."organizations"
        DROP COLUMN "coverUrl",
        DROP COLUMN "logoUrl"
    `);
  }
}
