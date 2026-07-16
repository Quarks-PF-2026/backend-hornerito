import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitPublicSchema1784231233000 implements MigrationInterface {
  name = 'InitPublicSchema1784231233000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying NOT NULL,
        "email" character varying NOT NULL,
        "passwordHash" character varying NOT NULL,
        "emailVerified" boolean NOT NULL DEFAULT false,
        "verificationToken" character varying,
        "verificationTokenExpiresAt" TIMESTAMP WITH TIME ZONE,
        "termsAcceptedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "PK_users" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."organizations_status_enum" AS ENUM ('pending', 'validated', 'rejected')
    `);

    await queryRunner.query(`
      CREATE TABLE "organizations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "ownerId" uuid NOT NULL,
        "name" character varying NOT NULL,
        "description" character varying NOT NULL,
        "address" character varying NOT NULL,
        "contact" character varying NOT NULL,
        "status" "public"."organizations_status_enum" NOT NULL DEFAULT 'pending',
        "rejectReason" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_organizations" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."organization_memberships_role_enum" AS ENUM ('owner')
    `);

    await queryRunner.query(`
      CREATE TABLE "organization_memberships" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "organizationId" uuid NOT NULL,
        "role" "public"."organization_memberships_role_enum" NOT NULL DEFAULT 'owner',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_organization_memberships" PRIMARY KEY ("id"),
        CONSTRAINT "FK_organization_memberships_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_organization_memberships_organization" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_organization_memberships_user_org" ON "organization_memberships" ("userId", "organizationId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_organization_memberships_user_org"`,
    );
    await queryRunner.query(`DROP TABLE "organization_memberships"`);
    await queryRunner.query(
      `DROP TYPE "public"."organization_memberships_role_enum"`,
    );
    await queryRunner.query(`DROP TABLE "organizations"`);
    await queryRunner.query(`DROP TYPE "public"."organizations_status_enum"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
