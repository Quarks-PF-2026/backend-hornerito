import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Donación económica (QK-20): alguien de afuera transfiere plata a la
 * organización y declara la donación desde la ficha pública; un owner o admin
 * confirma la recepción contra el extracto bancario.
 *
 * Comparte la tabla `donations` con la presencial (QK-26) vía herencia de tabla
 * única: la columna `kind` es el discriminador. Las dos variantes comparten
 * donante y fechas, pero no el ciclo de vida — la presencial nace recibida y no
 * tiene estados, la económica arranca `declarada` y necesita una decisión. Los
 * CHECK de más abajo hacen cumplir esa separación en la base, no solo en el
 * código. Esto cierra la contradicción anotada en PROYECTO.md §3 entre
 * DOMAIN.md §7 ("la donación tiene estado") y QK-26 ("no hay estados").
 *
 * `kind` entra con DEFAULT 'presencial', así que las filas que ya existen
 * quedan bien clasificadas sin backfill.
 *
 * Sobre la RLS, que es la parte no obvia: hasta hoy `donations` solo la escribía
 * el panel, con `hornerito_app` y `app.current_org` seteado. El INSERT de la
 * económica lo hace un visitante anónimo, por una conexión que nunca hizo
 * `SET ROLE`: corre como owner de la base, y en Postgres el owner NO está
 * sujeto a RLS salvo que la tabla tenga `FORCE ROW LEVEL SECURITY`. Por eso la
 * policy existente no lo bloquea, y por eso NO hay que agregar `FORCE`:
 * rompería la vía anónima. Mismo razonamiento que en AddVolunteerRequests.
 *
 * El aislamiento del insert lo garantiza `MonetaryDonationService.declare`, que
 * resuelve el `organizationId` desde la organización `validated` de la URL antes
 * de escribir (CLAUDE.md §6: RLS es la red de seguridad, no el filtro).
 */
export class AddMonetaryDonations1786600000000 implements MigrationInterface {
  name = 'AddMonetaryDonations1786600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Datos bancarios de la organización: sin ellos el donante no tiene a dónde
    // transferir, así que `paymentAlias` es lo que habilita la sección "Donar
    // dinero" en la ficha pública. Mismo criterio que `seeksVolunteers`.
    await queryRunner.query(`
      ALTER TABLE "organizations"
        ADD COLUMN "paymentAlias"  character varying(60),
        ADD COLUMN "paymentHolder" character varying(120),
        ADD COLUMN "paymentCuit"   character varying(13),
        ADD COLUMN "paymentBank"   character varying(80)
    `);

    await queryRunner.query(`
      CREATE TYPE "donations_kind_enum" AS ENUM ('presencial', 'economica')
    `);
    await queryRunner.query(`
      CREATE TYPE "donations_status_enum"
        AS ENUM ('declarada', 'confirmada', 'rechazada')
    `);
    // 'mercadopago' existe en la base desde ahora aunque el service todavía lo
    // rechace con 501: el día que se implemente no hace falta migrar datos.
    await queryRunner.query(`
      CREATE TYPE "donations_method_enum"
        AS ENUM ('transferencia', 'mercadopago')
    `);

    await queryRunner.query(`
      ALTER TABLE "donations"
        ADD COLUMN "kind" "donations_kind_enum" NOT NULL DEFAULT 'presencial',
        ADD COLUMN "status" "donations_status_enum",
        ADD COLUMN "method" "donations_method_enum",
        ADD COLUMN "amount" numeric(12,2),
        ADD COLUMN "operationNumber" character varying(60),
        ADD COLUMN "receiptUrl" text,
        ADD COLUMN "receiptPublicId" character varying(200),
        ADD COLUMN "externalPaymentId" character varying(100),
        ADD COLUMN "decidedByUserId" uuid,
        ADD COLUMN "decidedAt" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "rejectReason" character varying
    `);

    await queryRunner.query(`
      ALTER TABLE "donations"
        ADD CONSTRAINT "FK_donations_decided_by" FOREIGN KEY ("decidedByUserId")
          REFERENCES "users" ("id") ON DELETE SET NULL
    `);

    // Las invariantes de cada variante, en la base (DOMAIN.md §11).
    await queryRunner.query(`
      ALTER TABLE "donations"
        ADD CONSTRAINT "CHK_donations_economica" CHECK (
          "kind" <> 'economica' OR (
            "amount" IS NOT NULL AND "amount" > 0
            AND "status" IS NOT NULL
            AND "method" IS NOT NULL
          )
        ),
        ADD CONSTRAINT "CHK_donations_presencial" CHECK (
          "kind" <> 'presencial' OR (
            "amount" IS NULL AND "status" IS NULL AND "method" IS NULL
          )
        ),
        ADD CONSTRAINT "CHK_donations_reject_reason" CHECK (
          "status" IS DISTINCT FROM 'rechazada' OR "rejectReason" IS NOT NULL
        ),
        ADD CONSTRAINT "CHK_donations_decided_at" CHECK (
          "status" IS NULL OR "status" = 'declarada' OR "decidedAt" IS NOT NULL
        )
    `);

    // El panel filtra por variante y estado, de la más nueva a la más vieja.
    await queryRunner.query(`
      CREATE INDEX "IDX_donations_org_kind_status"
        ON "donations" ("organizationId", "kind", "status", "createdAt" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_donations_org_kind_status"
    `);
    for (const constraint of [
      'CHK_donations_decided_at',
      'CHK_donations_reject_reason',
      'CHK_donations_presencial',
      'CHK_donations_economica',
      'FK_donations_decided_by',
    ]) {
      await queryRunner.query(`
        ALTER TABLE "donations" DROP CONSTRAINT IF EXISTS "${constraint}"
      `);
    }

    await queryRunner.query(`
      ALTER TABLE "donations"
        DROP COLUMN IF EXISTS "rejectReason",
        DROP COLUMN IF EXISTS "decidedAt",
        DROP COLUMN IF EXISTS "decidedByUserId",
        DROP COLUMN IF EXISTS "externalPaymentId",
        DROP COLUMN IF EXISTS "receiptPublicId",
        DROP COLUMN IF EXISTS "receiptUrl",
        DROP COLUMN IF EXISTS "operationNumber",
        DROP COLUMN IF EXISTS "amount",
        DROP COLUMN IF EXISTS "method",
        DROP COLUMN IF EXISTS "status",
        DROP COLUMN IF EXISTS "kind"
    `);

    await queryRunner.query(`DROP TYPE IF EXISTS "donations_method_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "donations_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "donations_kind_enum"`);

    await queryRunner.query(`
      ALTER TABLE "organizations"
        DROP COLUMN IF EXISTS "paymentBank",
        DROP COLUMN IF EXISTS "paymentCuit",
        DROP COLUMN IF EXISTS "paymentHolder",
        DROP COLUMN IF EXISTS "paymentAlias"
    `);
  }
}
