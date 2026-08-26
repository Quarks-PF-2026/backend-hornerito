import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Flag de administrador de la plataforma (QK-13: validar/rechazar
 * organizaciones). Es un rol aparte de los roles de organización
 * (OrganizationMembershipRole): un platform admin no pertenece a ninguna
 * organización en particular, audita a todas.
 *
 * No hay alta automática ni endpoint público para setearlo: se asigna a
 * mano en la base (`UPDATE users SET "isPlatformAdmin" = true WHERE email =
 * '...'`), igual que en cualquier plataforma chica sin un equipo de soporte
 * dedicado.
 */
export class AddPlatformAdmin1785100000000 implements MigrationInterface {
  name = 'AddPlatformAdmin1785100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "public"."users"
        ADD COLUMN "isPlatformAdmin" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "public"."users"
        DROP COLUMN "isPlatformAdmin"
    `);
  }
}
