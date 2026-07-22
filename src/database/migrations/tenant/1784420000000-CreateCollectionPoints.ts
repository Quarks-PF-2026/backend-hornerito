import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCollectionPoints1784420000000 implements MigrationInterface {
  name = 'CreateCollectionPoints1784420000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "collection_points" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying NOT NULL,
        "addressLine" character varying NOT NULL,
        "latitude" numeric(9,6) NOT NULL,
        "longitude" numeric(9,6) NOT NULL,
        "phone" character varying NOT NULL,
        "email" character varying,
        "contactName" character varying,
        "schedule" jsonb NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_collection_points" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_collection_points_name"
        ON "collection_points" (lower("name"))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_collection_points_name"`);
    await queryRunner.query(`DROP TABLE "collection_points"`);
  }
}
