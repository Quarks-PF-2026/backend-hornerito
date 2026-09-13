import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Teléfono del perfil (QK-11, Administrar Perfil).
 *
 * `users` es global: una persona puede ser miembro de varias organizaciones,
 * así que el teléfono es un dato de la persona y no de su membresía. Por eso va
 * acá, sin `organizationId` ni policy RLS, y no en `organization_members`.
 *
 * `varchar(20)` alcanza para E.164 sin espacios (`+` opcional y hasta 15
 * dígitos = 16 caracteres) con margen, sin invitar a guardar texto libre. El
 * formato se valida en el DTO; no se duplica como CHECK en la base porque el
 * contrato del formato es de presentación y cambiarlo después obligaría a otra
 * migración sin ganar aislamiento.
 *
 * NULL permitido y sin default: los usuarios existentes no tienen teléfono y
 * inventarles uno sería peor que dejarlo vacío. Sin índice ni UNIQUE: el
 * teléfono no identifica a la persona (dos personas pueden compartir línea) y
 * nadie busca por él.
 *
 * GRANTs: `hornerito_app` tiene `SELECT` sobre `users` a nivel de tabla
 * (ColumnBasedTenancy), que en Postgres cubre también las columnas agregadas
 * después. No hay GRANTs por columna, así que no hace falta tocar permisos.
 */
export class AddUserPhone1786700000000 implements MigrationInterface {
  name = 'AddUserPhone1786700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "public"."users"
        ADD COLUMN "phone" character varying(20)
    `);
  }

  // Reversible sin pérdida de esquema; sí se pierden los teléfonos cargados
  // mientras la columna existió, que es inherente a revertir esta migración.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "public"."users"
        DROP COLUMN "phone"
    `);
  }
}
