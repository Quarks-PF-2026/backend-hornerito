import { MigrationInterface, QueryRunner } from 'typeorm';

const APP_ROLE = 'hornerito_app';

/** Igual que en ColumnBasedTenancy: sin la variable seteada no se ve nada. */
const CURRENT_ORG = `NULLIF(current_setting('app.current_org', true), '')::uuid`;

/**
 * Historias de organización (QK-111, DOMAIN.md §18).
 *
 * Quién toca cada tabla y con qué rol:
 * - El panel (publicar, listar vigentes y vencidas, eliminar) corre bajo
 *   `TenantGuard`, o sea con `SET ROLE "hornerito_app"` y `app.current_org`
 *   seteado: ahí rige `tenant_isolation` como en el resto del tenant.
 * - Las lecturas públicas (barra del inicio, perfil de la organización) y el
 *   registro de una vista (`POST /public/stories/:id/view`, que escribe
 *   `story_views` fuera de cualquier tenant) corren como owner por la vía
 *   pública, igual que el directorio y el ranking de donantes. La policy no les
 *   aplica porque no hay `FORCE ROW LEVEL SECURITY` (coherente con el resto del
 *   esquema), así que esas queries filtran todo explícito: organización
 *   `validated`, `deletedAt IS NULL`, `expiresAt > now()` y, para la vista, que
 *   la historia exista y esté vigente antes de insertar.
 *
 * Vencimiento perezoso: `expiresAt` se persiste al publicar (alta + 7 días) y
 * toda query de lectura lo compara contra `now()`. No hay job que marque nada:
 * una historia vencida es solo una fila cuyo `expiresAt` ya pasó. Por eso no
 * hay CHECK `expiresAt > createdAt`: no protege nada que el service no fije y
 * le impediría a los tests forzar el vencimiento moviendo `expiresAt`.
 *
 * Borrado lógico: eliminar es setear `deletedAt`, nunca un DELETE físico
 * (invariante 19, DOMAIN.md §11; la eliminada se conserva y libera cupo). Para
 * que eso no dependa solo del código, `hornerito_app` **no** recibe `DELETE`
 * sobre `stories`, a diferencia del resto de las tablas del tenant: el panel
 * no puede borrar una historia aunque quiera. El `CASCADE` desde
 * `organizations` sigue funcionando porque las acciones referenciales las
 * ejecuta Postgres con los permisos del owner de la tabla.
 *
 * `mediaType` es un enum de Postgres, como el resto de los enums del esquema.
 * `CHK_stories_linkUrl` es red de seguridad contra `javascript:` y similares;
 * la validación de negocio (y el mensaje) vive en el DTO. Va con `~*` para no
 * convertir en un 500 un `HTTPS://` que el DTO considere válido.
 * `createdByUserId` es `SET NULL`, como `decidedByUserId`: si la cuenta se
 * borra, la historia sigue siendo de la organización (cualquier responsable
 * puede eliminarla, no solo quien la publicó).
 *
 * `story_views` cuelga de la historia con FK compuesta
 * `(organizationId, storyId)` → `UQ_stories_org_id`, así una vista no puede
 * apuntar a una historia de otra organización. `CASCADE` ahí no borra
 * historial: las historias nunca se borran físicamente salvo que se borre la
 * organización entera. La PK `(storyId, userId)` hace idempotente el registro
 * (`ON CONFLICT DO NOTHING`) y cubre el anti-join "historias que este usuario
 * no vio".
 *
 * Índices:
 * - `IDX_stories_org_expiresAt`: panel (vigentes / historial) y conteo de
 *   vigentes para el tope de 20, siempre por organización.
 * - `IDX_stories_live_expiresAt`, parcial sin borradas: la barra del inicio
 *   recorta por `expiresAt > now()` entre todas las organizaciones. Como nada
 *   se borra físicamente, la tabla crece sin techo y sin este índice cada
 *   visita al inicio barrería todo el historial para devolver una semana.
 * - `IDX_story_views_userId`: el `CASCADE` al borrar una cuenta y el anti-join
 *   cuando el planner arranca del lado del usuario. La PK arranca por
 *   `storyId` y no sirve para eso.
 *
 * El `down` borra ambas tablas con sus filas: historias y vistas se pierden, y
 * los archivos quedan huérfanos en Cloudinary.
 */
export class AddStories1787400000000 implements MigrationInterface {
  name = 'AddStories1787400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "stories_mediatype_enum" AS ENUM ('image', 'video')
    `);

    await queryRunner.query(`
      CREATE TABLE "stories" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "createdByUserId" uuid,
        "mediaUrl" text NOT NULL,
        "mediaPublicId" character varying(200) NOT NULL,
        "mediaType" "stories_mediatype_enum" NOT NULL,
        "durationSec" numeric(6,2),
        "text" character varying(200),
        "linkUrl" character varying(500),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_stories" PRIMARY KEY ("id"),
        CONSTRAINT "FK_stories_organization" FOREIGN KEY ("organizationId")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_stories_createdByUserId" FOREIGN KEY ("createdByUserId")
          REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "UQ_stories_org_id" UNIQUE ("organizationId", "id"),
        CONSTRAINT "CHK_stories_linkUrl" CHECK ("linkUrl" ~* '^https?://')
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_stories_org_expiresAt"
        ON "stories" ("organizationId", "expiresAt")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_stories_live_expiresAt"
        ON "stories" ("expiresAt") WHERE "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "story_views" (
        "storyId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "organizationId" uuid NOT NULL,
        "viewedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_story_views" PRIMARY KEY ("storyId", "userId"),
        CONSTRAINT "FK_story_views_organization" FOREIGN KEY ("organizationId")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_story_views_story" FOREIGN KEY ("organizationId", "storyId")
          REFERENCES "stories" ("organizationId", "id") ON DELETE CASCADE,
        CONSTRAINT "FK_story_views_userId" FOREIGN KEY ("userId")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_story_views_userId" ON "story_views" ("userId")
    `);

    // Sin DELETE sobre `stories`: ver cabecera (borrado lógico).
    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE ON "stories" TO "${APP_ROLE}"
    `);
    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON "story_views" TO "${APP_ROLE}"
    `);
    for (const table of ['stories', 'story_views']) {
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
    for (const table of ['story_views', 'stories']) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS "tenant_isolation" ON "${table}"`,
      );
      await queryRunner.query(`REVOKE ALL ON "${table}" FROM "${APP_ROLE}"`);
      // Los índices y constraints caen con la tabla.
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }
    await queryRunner.query(`DROP TYPE IF EXISTS "stories_mediatype_enum"`);
  }
}
