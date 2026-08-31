import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Observable, finalize } from 'rxjs';
import { DataSource, QueryRunner } from 'typeorm';
import type { TenantScopedRequest } from './tenant-request';

/**
 * Rol sin privilegios de owner al que se conmuta durante las requests
 * tenant-scoped. Postgres no le aplica RLS al dueño de la tabla, así que sin
 * este `SET ROLE` las políticas no harían nada. Lo crea la migración
 * `ColumnBasedTenancy1786000000000`.
 */
export const APP_DB_ROLE = 'hornerito_app';

/** Variable de sesión que leen las políticas RLS. */
export const CURRENT_ORG_SETTING = 'app.current_org';

/**
 * Ata la request a una conexión con el tenant activo.
 *
 * Corre después de los guards, así que `TenantGuard` ya dejó
 * `request.organization`. Si no hay organización (rutas públicas, auth,
 * invitaciones por token) no hace nada y todo sigue corriendo como owner, que
 * es lo que necesitan las lecturas cross-tenant legítimas.
 *
 * **Invariante que impone al resto del código:** mientras el runner esté
 * tomado, nada en esa request puede pedirle otra conexión al pool. El runner
 * no vuelve hasta el `finalize()`, así que un `@InjectRepository` en un
 * servicio tenant-scoped espera una conexión que solo se libera cuando termine
 * la request que está esperando: deadlock, no lentitud. En desarrollo pasa
 * inadvertido porque sobran conexiones; con el pool chico de serverless es un
 * 504 a los 300s que además envenena la instancia. De ahí que los servicios
 * bajo `TenantGuard` pidan el manager a `TenantContextService`, y que
 * `tenant-pool-deadlock.e2e-spec.ts` estrangule el pool para que la invariante
 * no se pueda romper en silencio.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<TenantScopedRequest>();
    const organizationId = request.organization?.id;
    if (!organizationId) {
      return next.handle();
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await queryRunner.query(`SET ROLE "${APP_DB_ROLE}"`);
      await queryRunner.query(`SELECT set_config($1, $2, false)`, [
        CURRENT_ORG_SETTING,
        organizationId,
      ]);
    } catch (error) {
      await queryRunner.release();
      throw error;
    }

    request.tenantQueryRunner = queryRunner;
    return next
      .handle()
      .pipe(finalize(() => void releaseTenantConnection(queryRunner)));
  }
}

/**
 * ponytail: el reset es best-effort. Si falla es porque la conexión ya está
 * rota, y en ese caso node-pg la descarta en vez de devolverla al pool, así que
 * no queda una conexión con el rol o la organización de otra request pegados.
 * Si alguna vez hiciera falta más garantía, el upgrade es envolver la request
 * en una transacción y usar `SET LOCAL`; se evitó porque la subida de imágenes
 * hace una llamada de red a Cloudinary que quedaría dentro de la transacción.
 */
async function releaseTenantConnection(
  queryRunner: QueryRunner,
): Promise<void> {
  try {
    await queryRunner.query(`RESET ROLE`);
    await queryRunner.query(`RESET ${CURRENT_ORG_SETTING}`);
  } catch {
    // Nada que hacer: la conexión rota no vuelve al pool.
  } finally {
    await queryRunner.release();
  }
}
