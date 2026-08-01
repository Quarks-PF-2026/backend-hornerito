import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMedia1784500000000 implements MigrationInterface {
  name = 'CreateMedia1784500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "media" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "ownerType" character varying NOT NULL,
        "ownerId" uuid NOT NULL,
        "purpose" character varying NOT NULL,
        "url" text NOT NULL,
        "publicId" text NOT NULL,
        "format" character varying NOT NULL,
        "width" integer NOT NULL,
        "height" integer NOT NULL,
        "bytes" integer NOT NULL,
        "createdBy" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_media" PRIMARY KEY ("id")
      )
    `);

    // Cada slot (por ejemplo el logo de la organización) es una sola imagen:
    // volver a subir reemplaza la anterior.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_media_owner_purpose"
        ON "media" ("ownerType", "ownerId", "purpose")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_media_owner_purpose"`);
    await queryRunner.query(`DROP TABLE "media"`);
  }
}
