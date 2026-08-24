import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Interruptor de la ficha pública (QK-16): la sección "Sumate como voluntario"
 * aparece solo si la organización lo prendió.
 *
 * Es una columna y no un derivado de "tiene tipos activos u oportunidades
 * abiertas" porque toda organización nace con los 5 tipos sembrados por
 * `OrganizationService.createMine`: derivarlo mostraría la sección en todas,
 * incluidas las que no están buscando a nadie.
 *
 * Arranca en `false`: nadie queda publicando un pedido que no hizo.
 */
export class AddSeeksVolunteers1786500000000 implements MigrationInterface {
  name = 'AddSeeksVolunteers1786500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organizations"
        ADD COLUMN "seeksVolunteers" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organizations" DROP COLUMN IF EXISTS "seeksVolunteers"
    `);
  }
}
