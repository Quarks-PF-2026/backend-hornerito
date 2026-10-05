import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adjuntos (imágenes y videos) en publicaciones.
 *
 * `media` era un archivo por slot (`logo`, `cover`). El purpose `attachment`
 * admite varias filas por owner, así que el índice único pasa a ser parcial:
 * sigue garantizando un archivo por slot para todo lo demás, y el tope de
 * adjuntos por publicación (4) lo controla el service, no el esquema.
 *
 * Como el índice parcial no cubre las filas `attachment`, se agrega
 * `IDX_media_org_owner_attachment` (no único) para listar los adjuntos de una
 * o varias publicaciones sin recorrer la tabla.
 *
 * `resourceType` hace falta para borrar en Cloudinary, que separa imágenes y
 * videos. Va como `varchar` sin CHECK, igual que `ownerType` y `purpose` de
 * esta misma tabla: lo manda el cliente al confirmar la subida, pero el
 * service lo valida contra la Admin API de Cloudinary (el recurso tiene que
 * existir con ese tipo), así que la base no agrega garantía. El default
 * `'image'` cubre las filas existentes (logos y portadas son siempre imágenes).
 *
 * `UQ_media_publicId` evita que dos confirmaciones concurrentes del mismo
 * archivo creen dos filas. Es global y no por organización a propósito: cada
 * subida genera un `publicId` nuevo dentro de una carpeta que ya incluye la
 * organización, así que dos tenants nunca comparten uno y las filas
 * existentes no chocan.
 *
 * No toca RLS ni GRANTs: `media` ya tiene la policy `tenant_isolation` y los
 * permisos de `hornerito_app` desde ColumnBasedTenancy, y aplican a columnas
 * e índices nuevos sin cambios.
 *
 * El `down` es destructivo: borra todas las filas `attachment` (si no, el
 * índice único completo no se puede recrear). Los archivos quedan huérfanos
 * en Cloudinary; el `down` no puede devolverlos ni limpiarlos.
 */
export class AddPostMedia1787000000000 implements MigrationInterface {
  name = 'AddPostMedia1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "media"
        ADD "resourceType" character varying NOT NULL DEFAULT 'image'
    `);
    await queryRunner.query(`DROP INDEX "IDX_media_org_owner_purpose"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_media_org_owner_purpose"
        ON "media" ("organizationId", "ownerType", "ownerId", "purpose")
        WHERE "purpose" <> 'attachment'
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_media_org_owner_attachment"
        ON "media" ("organizationId", "ownerType", "ownerId")
        WHERE "purpose" = 'attachment'
    `);
    await queryRunner.query(`
      ALTER TABLE "media" ADD CONSTRAINT "UQ_media_publicId" UNIQUE ("publicId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "media" WHERE "purpose" = 'attachment'`,
    );
    await queryRunner.query(
      `ALTER TABLE "media" DROP CONSTRAINT "UQ_media_publicId"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_media_org_owner_attachment"`);
    await queryRunner.query(`DROP INDEX "IDX_media_org_owner_purpose"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_media_org_owner_purpose"
        ON "media" ("organizationId", "ownerType", "ownerId", "purpose")
    `);
    await queryRunner.query(`ALTER TABLE "media" DROP COLUMN "resourceType"`);
  }
}
