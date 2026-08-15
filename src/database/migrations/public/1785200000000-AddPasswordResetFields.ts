import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPasswordResetFields1785200000000 implements MigrationInterface {
  name = 'AddPasswordResetFields1785200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "public"."users"
        ADD COLUMN "resetPasswordToken" character varying,
        ADD COLUMN "resetPasswordTokenExpiresAt" TIMESTAMP WITH TIME ZONE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "public"."users"
        DROP COLUMN "resetPasswordTokenExpiresAt",
        DROP COLUMN "resetPasswordToken"
    `);
  }
}
