import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tipo de cuenta del usuario: `donor` (default, la mayoría) u
 * `organization`. Se elige al registrarse y el backend lo hace cumplir: un
 * donante no puede crear una organización, y una cuenta de organización que
 * declara una donación económica no queda asociada (no entra en ranking ni
 * perfil de donante).
 *
 * `users` es tabla global, no del tenant: no lleva RLS ni GRANTs nuevos. El
 * `GRANT SELECT` de `hornerito_app` es a nivel tabla y ya cubre la columna.
 *
 * El DEFAULT 'donor' es parte del contrato, no solo del backfill: hay INSERTs
 * crudos (p. ej. los steps de aceptación) que no mandan la columna.
 *
 * Backfill: quien ya pertenece o es dueño de una organización pasa a
 * `organization`, para que nadie que hoy gestiona una organización quede
 * clasificado como donante. Es una heurística sobre datos previos a la
 * elección explícita; el `down` no necesita deshacerlo porque borra la
 * columna entera.
 */
export class AddAccountType1787500000000 implements MigrationInterface {
  name = 'AddAccountType1787500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."users_accounttype_enum"
      AS ENUM ('donor', 'organization')
    `);
    await queryRunner.query(`
      ALTER TABLE "public"."users"
        ADD COLUMN "accountType" "public"."users_accounttype_enum"
          NOT NULL DEFAULT 'donor'
    `);
    await queryRunner.query(`
      UPDATE "public"."users" SET "accountType" = 'organization'
      WHERE "id" IN (
        SELECT "userId" FROM "public"."organization_memberships"
        UNION
        SELECT "ownerId" FROM "public"."organizations"
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "public"."users" DROP COLUMN "accountType"
    `);
    await queryRunner.query(`DROP TYPE "public"."users_accounttype_enum"`);
  }
}
