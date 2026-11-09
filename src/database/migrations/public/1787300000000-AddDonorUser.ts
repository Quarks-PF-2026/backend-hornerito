import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Donar con la sesión iniciada (QK-113), base del ranking mensual (QK-114,
 * QK-115) y del perfil público del donante (QK-110).
 *
 * `donorUserId` es nullable y queda NULL en todas las filas que ya existen: la
 * asociación a una cuenta no es retroactiva. No se intenta reconstruirla por
 * nombre o correo, porque eso le atribuiría a alguien una donación que no hizo
 * con su sesión (QK-113 lo prohíbe explícitamente). Referencia a `users`, que es
 * global, así que la FK es simple y no compuesta con `organizationId`. `ON
 * DELETE SET NULL`, igual que `decidedByUserId`: si la cuenta se borra, la
 * donación sigue siendo de la organización y solo pierde el vínculo.
 *
 * `isAnonymous` arranca en false para las filas existentes. Es anonimato frente
 * al público (ranking, perfil); la organización sigue viendo nombre y contacto
 * (DOMAIN.md §7).
 *
 * Índices:
 * - `IDX_donations_kind_status_createdAt`: el ranking global corta por variante,
 *   estado y mes *entre* organizaciones. `IDX_donations_org_kind_status`
 *   (AddMonetaryDonations) arranca por `organizationId` y no sirve para ese
 *   recorte; sí cubre el top por organización (QK-115), así que ese no se
 *   duplica.
 * - `IDX_donations_donorUserId`, parcial: el perfil público busca por donante a
 *   través de todas las organizaciones, y el `SET NULL` al borrar una cuenta
 *   haría un scan completo sin índice. Parcial porque la mayoría de las filas
 *   (presenciales, visitantes sin sesión) tienen NULL y no se consultan nunca
 *   por esa columna.
 *
 * Sobre la RLS: no cambia nada. `donations` tiene `tenant_isolation` sin
 * `FORCE ROW LEVEL SECURITY`, así que las lecturas del ranking y del perfil, que
 * corren en `PublicService` como owner (sin `SET ROLE "hornerito_app"`), no
 * están sujetas a la policy y pueden sumar entre organizaciones. Es el mismo
 * trade-off que el directorio público y que el insert anónimo de
 * AddMonetaryDonations: la vía pública depende de no agregar `FORCE`, y el
 * recorte lo hace la query (organización `validated`, `confirmada`, no anónima),
 * no la base. Las columnas nuevas entran solas en los GRANT por tabla de
 * `hornerito_app`, y la FK la chequea Postgres como owner de `users`, así que el
 * insert desde el panel no necesita más permisos que el `SELECT` que ya tiene.
 */
export class AddDonorUser1787300000000 implements MigrationInterface {
  name = 'AddDonorUser1787300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "donations"
        ADD COLUMN "donorUserId" uuid,
        ADD COLUMN "isAnonymous" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "donations"
        ADD CONSTRAINT "FK_donations_donorUserId" FOREIGN KEY ("donorUserId")
          REFERENCES "users" ("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_donations_kind_status_createdAt"
        ON "donations" ("kind", "status", "createdAt")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_donations_donorUserId"
        ON "donations" ("donorUserId") WHERE "donorUserId" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_donations_donorUserId"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_donations_kind_status_createdAt"`,
    );
    await queryRunner.query(`
      ALTER TABLE "donations"
        DROP CONSTRAINT IF EXISTS "FK_donations_donorUserId"
    `);
    await queryRunner.query(`
      ALTER TABLE "donations"
        DROP COLUMN IF EXISTS "isAnonymous",
        DROP COLUMN IF EXISTS "donorUserId"
    `);
  }
}
