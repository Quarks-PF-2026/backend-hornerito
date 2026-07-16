import 'dotenv/config';
import { DataSource } from 'typeorm';
import { runTenantMigrations } from './tenant-migration-runner';
import { isTenantSchemaName } from '../modules/tenant/tenant-schema.util';

async function main(): Promise<void> {
  const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
  });
  await dataSource.initialize();
  const rows: Array<{ schema_name: string }> = await dataSource.query(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'org_%'`,
  );
  await dataSource.destroy();

  const tenantSchemas = rows
    .map((row) => row.schema_name)
    .filter(isTenantSchemaName);

  for (const schemaName of tenantSchemas) {
    console.log(`Running tenant migrations for ${schemaName}...`);
    await runTenantMigrations(schemaName);
  }
  console.log(`Done. ${tenantSchemas.length} tenant schema(s) migrated.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
