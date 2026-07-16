import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNeeds1784238534583 implements MigrationInterface {
  name = 'CreateNeeds1784238534583';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "needs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "supplyId" uuid NOT NULL,
        "requiredQuantity" integer NOT NULL,
        "coveredQuantity" integer NOT NULL DEFAULT 0,
        "deadline" date NOT NULL,
        "closedManually" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_needs" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_needs_supplyId" ON "needs" ("supplyId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_needs_supplyId"`);
    await queryRunner.query(`DROP TABLE "needs"`);
  }
}
