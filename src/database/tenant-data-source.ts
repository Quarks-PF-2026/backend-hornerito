import { DataSource, DataSourceOptions } from 'typeorm';

export interface TenantDataSourceOptions {
  schema: string;
  entities?: DataSourceOptions['entities'];
  migrations?: DataSourceOptions['migrations'];
  poolSize?: number;
}

export function createTenantDataSource(
  options: TenantDataSourceOptions,
): DataSource {
  return new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    schema: options.schema,
    // El option `schema` de arriba solo afecta el SQL que genera TypeORM
    // (query builder / repositorios). Las queries crudas (`.query(...)`)
    // dependen del `search_path` real de la conexión Postgres, así que se
    // fuerza acá para que ambos caminos queden en el schema del tenant.
    extra: {
      options: `-c search_path=${options.schema}`,
    },
    entities: options.entities ?? [],
    migrations: options.migrations ?? [
      __dirname + '/migrations/tenant/*{.ts,.js}',
    ],
    migrationsTableName: 'migrations',
    poolSize: options.poolSize,
  });
}
