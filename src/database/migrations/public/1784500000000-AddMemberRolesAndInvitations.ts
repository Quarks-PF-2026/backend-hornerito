import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMemberRolesAndInvitations1784500000000 implements MigrationInterface {
  name = 'AddMemberRolesAndInvitations1784500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // `ALTER TYPE ... ADD VALUE` no puede correr dentro de una transacción y
    // TypeORM transacciona las migraciones: se recrea el tipo en su lugar.
    await queryRunner.query(`
      ALTER TYPE "public"."organization_memberships_role_enum"
      RENAME TO "organization_memberships_role_enum_old"
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."organization_memberships_role_enum"
      AS ENUM ('owner', 'admin', 'coordinador', 'voluntario')
    `);

    await queryRunner.query(`
      ALTER TABLE "organization_memberships"
        ALTER COLUMN "role" DROP DEFAULT,
        ALTER COLUMN "role" TYPE "public"."organization_memberships_role_enum"
          USING "role"::text::"public"."organization_memberships_role_enum",
        ALTER COLUMN "role" SET DEFAULT 'owner'
    `);

    await queryRunner.query(`
      DROP TYPE "public"."organization_memberships_role_enum_old"
    `);

    await queryRunner.query(`
      ALTER TABLE "organization_memberships"
      ADD "active" boolean NOT NULL DEFAULT true
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."organization_invitations_role_enum"
      AS ENUM ('owner', 'admin', 'coordinador', 'voluntario')
    `);

    await queryRunner.query(`
      CREATE TABLE "organization_invitations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "email" character varying NOT NULL,
        "role" "public"."organization_invitations_role_enum" NOT NULL DEFAULT 'voluntario',
        "token" character varying NOT NULL,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "acceptedAt" TIMESTAMP WITH TIME ZONE,
        "invitedByUserId" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_organization_invitations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_organization_invitations_organization" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_organization_invitations_invited_by" FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_organization_invitations_token"
      ON "organization_invitations" ("token")
    `);

    // Una sola invitación pendiente por correo y organización; las ya
    // aceptadas quedan como histórico y no bloquean una nueva.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_organization_invitations_pending"
      ON "organization_invitations" ("organizationId", "email")
      WHERE "acceptedAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_organization_invitations_pending"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_organization_invitations_token"`,
    );
    await queryRunner.query(`DROP TABLE "organization_invitations"`);
    await queryRunner.query(
      `DROP TYPE "public"."organization_invitations_role_enum"`,
    );

    await queryRunner.query(
      `ALTER TABLE "organization_memberships" DROP COLUMN "active"`,
    );

    // Las membresías que no son owner no existen en el enum viejo: se borran.
    await queryRunner.query(
      `DELETE FROM "organization_memberships" WHERE "role" <> 'owner'`,
    );

    await queryRunner.query(`
      ALTER TYPE "public"."organization_memberships_role_enum"
      RENAME TO "organization_memberships_role_enum_old"
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."organization_memberships_role_enum" AS ENUM ('owner')
    `);

    await queryRunner.query(`
      ALTER TABLE "organization_memberships"
        ALTER COLUMN "role" DROP DEFAULT,
        ALTER COLUMN "role" TYPE "public"."organization_memberships_role_enum"
          USING "role"::text::"public"."organization_memberships_role_enum",
        ALTER COLUMN "role" SET DEFAULT 'owner'
    `);

    await queryRunner.query(
      `DROP TYPE "public"."organization_memberships_role_enum_old"`,
    );
  }
}
