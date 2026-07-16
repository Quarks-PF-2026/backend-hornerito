import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSupplies1784235495482 implements MigrationInterface {
  name = 'CreateSupplies1784235495482';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "supplies_category_enum" AS ENUM ('Alimentos secos', 'Frescos', 'Limpieza', 'Higiene', 'Bebidas')
    `);

    await queryRunner.query(`
      CREATE TYPE "supplies_unit_enum" AS ENUM ('Kilogramos', 'Litros', 'Unidades', 'Paquetes', 'Cajas')
    `);

    await queryRunner.query(`
      CREATE TABLE "supplies" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying NOT NULL,
        "category" "supplies_category_enum" NOT NULL,
        "unit" "supplies_unit_enum" NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_supplies" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "supplies"`);
    await queryRunner.query(`DROP TYPE "supplies_unit_enum"`);
    await queryRunner.query(`DROP TYPE "supplies_category_enum"`);
  }
}
