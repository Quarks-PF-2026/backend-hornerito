import { MigrationInterface, QueryRunner } from 'typeorm';

/** Tablas operativas del tenant, ahora en `public` con `organizationId`. */
const TENANT_TABLES = [
  'supplies',
  'needs',
  'posts',
  'collection_points',
  'media',
];

/**
 * Estas dos ya tenían `organizationId` y solo se tocan bajo `TenantGuard`, así
 * que entran a la misma política. `TenantGuard` y el login las leen *antes* del
 * `SET ROLE`, o sea como owner, y por eso siguen pudiendo mirar entre orgs.
 */
const SHARED_SCOPED_TABLES = [
  'organization_memberships',
  'organization_invitations',
];

const RLS_TABLES = [...TENANT_TABLES, ...SHARED_SCOPED_TABLES];

export const APP_ROLE = 'hornerito_app';

/**
 * Organización activa de la conexión. `current_setting(..., true)` da NULL si
 * la variable no está seteada; el `NULLIF` cubre además el caso de que quede en
 * cadena vacía, que sin él haría fallar el cast a uuid en vez de denegar.
 */
const CURRENT_ORG = `NULLIF(current_setting('app.current_org', true), '')::uuid`;

/**
 * Multi-tenancy por columna en vez de por schema.
 *
 * Destructiva a propósito: los schemas `org_*` se dropean sin copiar datos.
 * El `down` recrea el espejo público y las tablas vacías, pero no puede
 * devolver los schemas por tenant ni sus filas.
 */
export class ColumnBasedTenancy1786000000000 implements MigrationInterface {
  name = 'ColumnBasedTenancy1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "public_needs"`);

    // `logoUrl` / `coverUrl` eran copias de `media` hechas para que el
    // directorio público no tuviera que abrir una conexión por tenant. Ahora
    // `media` está en `public` y se joinea directo.
    await queryRunner.query(`
      ALTER TABLE "organizations"
        DROP COLUMN IF EXISTS "logoUrl",
        DROP COLUMN IF EXISTS "coverUrl"
    `);

    await queryRunner.query(`
      DO $$
      DECLARE schema_record record;
      BEGIN
        FOR schema_record IN
          SELECT schema_name FROM information_schema.schemata
          WHERE schema_name LIKE 'org\\_%'
        LOOP
          EXECUTE format('DROP SCHEMA %I CASCADE', schema_record.schema_name);
        END LOOP;
      END $$
    `);

    await queryRunner.query(`
      CREATE TYPE "supplies_category_enum" AS ENUM ('Alimentos secos', 'Frescos', 'Limpieza', 'Higiene', 'Bebidas')
    `);
    await queryRunner.query(`
      CREATE TYPE "supplies_unit_enum" AS ENUM ('Kilogramos', 'Litros', 'Unidades', 'Paquetes', 'Cajas')
    `);

    await queryRunner.query(`
      CREATE TABLE "supplies" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "name" character varying NOT NULL,
        "category" "supplies_category_enum" NOT NULL,
        "unit" "supplies_unit_enum" NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_supplies" PRIMARY KEY ("id"),
        CONSTRAINT "FK_supplies_organization" FOREIGN KEY ("organizationId")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        -- Destino de la FK compuesta de "needs": es lo que impide que una
        -- necesidad apunte a un insumo de otra organización.
        CONSTRAINT "UQ_supplies_org_id" UNIQUE ("organizationId", "id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "needs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "supplyId" uuid NOT NULL,
        "requiredQuantity" integer NOT NULL,
        "coveredQuantity" integer NOT NULL DEFAULT 0,
        "deadline" date NOT NULL,
        "closedManually" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_needs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_needs_organization" FOREIGN KEY ("organizationId")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_needs_supply" FOREIGN KEY ("organizationId", "supplyId")
          REFERENCES "supplies" ("organizationId", "id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_needs_org_supply" ON "needs" ("organizationId", "supplyId")
    `);
    // El feed público ordena por vencimiento dentro de cada organización.
    await queryRunner.query(`
      CREATE INDEX "IDX_needs_org_deadline" ON "needs" ("organizationId", "deadline")
    `);

    await queryRunner.query(`
      CREATE TABLE "posts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "title" character varying(120) NOT NULL,
        "content" text NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_posts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_posts_organization" FOREIGN KEY ("organizationId")
          REFERENCES "organizations" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_posts_org_createdAt" ON "posts" ("organizationId", "createdAt" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE "collection_points" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "name" character varying NOT NULL,
        "addressLine" character varying NOT NULL,
        "latitude" numeric(9,6) NOT NULL,
        "longitude" numeric(9,6) NOT NULL,
        "phone" character varying NOT NULL,
        "email" character varying,
        "contactName" character varying,
        "schedule" jsonb NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_collection_points" PRIMARY KEY ("id"),
        CONSTRAINT "FK_collection_points_organization" FOREIGN KEY ("organizationId")
          REFERENCES "organizations" ("id") ON DELETE CASCADE
      )
    `);
    // El nombre era único por schema; ahora lo es dentro de la organización.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_collection_points_org_name"
        ON "collection_points" ("organizationId", lower("name"))
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_collection_points_org_active"
        ON "collection_points" ("organizationId", "active")
    `);

    await queryRunner.query(`
      CREATE TABLE "media" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "ownerType" character varying NOT NULL,
        "ownerId" uuid NOT NULL,
        "purpose" character varying NOT NULL,
        "url" text NOT NULL,
        "publicId" text NOT NULL,
        "format" character varying NOT NULL,
        "width" integer NOT NULL,
        "height" integer NOT NULL,
        "bytes" integer NOT NULL,
        "createdBy" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_media" PRIMARY KEY ("id"),
        CONSTRAINT "FK_media_organization" FOREIGN KEY ("organizationId")
          REFERENCES "organizations" ("id") ON DELETE CASCADE
      )
    `);
    // Cada slot (por ejemplo el logo de la organización) es una sola imagen:
    // volver a subir reemplaza la anterior.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_media_org_owner_purpose"
        ON "media" ("organizationId", "ownerType", "ownerId", "purpose")
    `);

    // --- Rol de la aplicación -------------------------------------------
    // RLS no se le aplica al dueño de las tablas. Las requests tenant-scoped
    // hacen `SET ROLE` a este rol sin privilegios de owner para quedar sujetas
    // a las políticas; los caminos cross-tenant legítimos (directorio público,
    // auth, TenantGuard, migraciones) siguen corriendo como owner.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
          CREATE ROLE "${APP_ROLE}" NOLOGIN;
        END IF;
      END $$
    `);
    // Sin esto, un owner que no sea superusuario no puede hacer `SET ROLE`.
    await queryRunner.query(`GRANT "${APP_ROLE}" TO CURRENT_USER`);
    await queryRunner.query(`GRANT USAGE ON SCHEMA "public" TO "${APP_ROLE}"`);
    for (const table of RLS_TABLES) {
      await queryRunner.query(`
        GRANT SELECT, INSERT, UPDATE, DELETE ON "${table}" TO "${APP_ROLE}"
      `);
    }
    // Lecturas de apoyo: el módulo de miembros resuelve nombres y correos.
    await queryRunner.query(
      `GRANT SELECT ON "organizations", "users" TO "${APP_ROLE}"`,
    );

    // --- Row-Level Security ---------------------------------------------
    // `current_setting(..., true)` da NULL si la variable no está seteada, la
    // comparación queda NULL y no se ve ninguna fila: el default es denegar.
    for (const table of RLS_TABLES) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`,
      );
      await queryRunner.query(`
        CREATE POLICY "tenant_isolation" ON "${table}"
          USING      ("organizationId" = ${CURRENT_ORG})
          WITH CHECK ("organizationId" = ${CURRENT_ORG})
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organizations"
        ADD COLUMN "logoUrl" text NULL,
        ADD COLUMN "coverUrl" text NULL
    `);

    for (const table of RLS_TABLES) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS "tenant_isolation" ON "${table}"`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`,
      );
      await queryRunner.query(`REVOKE ALL ON "${table}" FROM "${APP_ROLE}"`);
    }
    await queryRunner.query(
      `REVOKE ALL ON "organizations", "users" FROM "${APP_ROLE}"`,
    );
    await queryRunner.query(
      `REVOKE USAGE ON SCHEMA "public" FROM "${APP_ROLE}"`,
    );
    await queryRunner.query(`DROP ROLE IF EXISTS "${APP_ROLE}"`);

    for (const table of TENANT_TABLES) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }
    await queryRunner.query(`DROP TYPE IF EXISTS "supplies_unit_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "supplies_category_enum"`);

    // Espejo público, idéntico al que dejaba AddPublicDirectory1785000000000.
    await queryRunner.query(`
      CREATE TABLE "public_needs" (
        "id" uuid NOT NULL,
        "organizationId" uuid NOT NULL,
        "supplyId" uuid NOT NULL,
        "supplyName" text NOT NULL,
        "supplyCategory" text NOT NULL,
        "supplyUnit" text NOT NULL,
        "requiredQuantity" integer NOT NULL,
        "coveredQuantity" integer NOT NULL DEFAULT 0,
        "deadline" date NOT NULL,
        "closed" boolean NOT NULL DEFAULT false,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_public_needs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_public_needs_org" ON "public_needs" ("organizationId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_public_needs_open" ON "public_needs" ("closed", "supplyCategory")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_public_needs_supply" ON "public_needs" ("supplyId")`,
    );
  }
}
