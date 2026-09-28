import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Localidad de la organización (QK-112), para que el visitante pueda encontrar
 * a las que están cerca suyo. Hoy `address` es texto libre: dos comedores de
 * la misma localidad la escriben de cinco formas distintas y no hay nada por
 * lo que agrupar. `locality` viene de una sugerencia del geocoder, así que
 * llega siempre escrita igual.
 *
 * Tres columnas planas y no una FK a una tabla `localities`: no hay nada que
 * colgar de una localidad. `province` y `country` se guardan para mostrarlos
 * en la ficha y para desempatar homónimas más adelante; cuando eso haga
 * falta, normalizar será otra migración con datos reales encima.
 *
 * Nullable y sin default a propósito: las organizaciones que ya existen quedan
 * sin localidad hasta que editen su perfil. No se les completa automáticamente
 * porque adivinar la localidad desde `address` es exactamente el error que
 * esta historia viene a evitar.
 */
export class AddOrganizationLocality1786800000000 implements MigrationInterface {
  name = 'AddOrganizationLocality1786800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organizations"
        ADD COLUMN "locality" character varying(120),
        ADD COLUMN "province" character varying(120),
        ADD COLUMN "country" character varying(120)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organizations"
        DROP COLUMN IF EXISTS "locality",
        DROP COLUMN IF EXISTS "province",
        DROP COLUMN IF EXISTS "country"
    `);
  }
}
