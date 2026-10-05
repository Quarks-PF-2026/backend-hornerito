import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Días de la semana y hora de comienzo de los eventos (QK-117, DOMAIN.md §16,
 * confirmado el 2026-10-05).
 *
 * `weekdays` es `smallint[]` (0 = domingo … 6 = sábado, la misma numeración que
 * `getUTCDay()` en el service) y no una tabla hija: siempre se lee y se escribe
 * entero junto con el evento, nunca se consulta por día, y un array evita un
 * join en cada cálculo de ocurrencias. "Diario" no es un tipo aparte: es elegir
 * los siete días, así las ocurrencias se derivan con una sola regla.
 *
 * `CHK_events_weekdays` sostiene la forma en el esquema y no solo en el DTO:
 * extraordinario sin días; periódico con al menos uno, todos en 0..6. El
 * `IS NOT NULL` explícito no es redundante: con `weekdays` NULL,
 * `cardinality` da NULL, el CHECK evalúa a NULL y Postgres lo deja pasar. El
 * `<@` contra el array completo cubre el rango; los duplicados no se chequean
 * acá (un CHECK no puede hacerlo sin una función) y los rechaza el DTO —
 * tampoco cambiarían las ocurrencias.
 *
 * Backfill: los periódicos existentes eran diarios por definición (la regla
 * anterior generaba una ocurrencia por día), así que reciben los siete días y
 * sus ocurrencias y asistencias históricas no cambian.
 *
 * `startTime` es `time` y obligatoria. Para agregarla NOT NULL sobre filas
 * existentes se usa un DEFAULT '00:00' transitorio que después se dropea:
 * las filas viejas quedan con una medianoche que no eligió nadie (la hora es
 * solo informativa, no restringe la carga de asistencia, así que el costo es
 * un dato a corregir a mano, no ocurrencias rotas), y las nuevas no pueden
 * colarse sin hora porque sin DEFAULT el INSERT que la omita falla.
 *
 * `down()` es lossy: dropea las columnas y con ellas los días elegidos y las
 * horas cargadas. Volver a subir no los recupera (todo periódico vuelve a
 * diario y toda hora a 00:00).
 */
export class AddEventScheduleFields1787100000000 implements MigrationInterface {
  name = 'AddEventScheduleFields1787100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "events" ADD COLUMN "weekdays" smallint[]`,
    );
    await queryRunner.query(`
      UPDATE "events" SET "weekdays" = '{0,1,2,3,4,5,6}'
       WHERE "kind" = 'periodic'
    `);

    await queryRunner.query(
      `ALTER TABLE "events" ADD COLUMN "startTime" time NOT NULL DEFAULT '00:00'`,
    );
    await queryRunner.query(
      `ALTER TABLE "events" ALTER COLUMN "startTime" DROP DEFAULT`,
    );

    await queryRunner.query(`
      ALTER TABLE "events" ADD CONSTRAINT "CHK_events_weekdays" CHECK (
        ("kind" = 'one_off' AND "weekdays" IS NULL)
        OR ("kind" = 'periodic'
            AND "weekdays" IS NOT NULL
            AND cardinality("weekdays") >= 1
            AND "weekdays" <@ '{0,1,2,3,4,5,6}'::smallint[])
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "events" DROP CONSTRAINT IF EXISTS "CHK_events_weekdays"`,
    );
    await queryRunner.query(
      `ALTER TABLE "events" DROP COLUMN IF EXISTS "startTime"`,
    );
    await queryRunner.query(
      `ALTER TABLE "events" DROP COLUMN IF EXISTS "weekdays"`,
    );
  }
}
