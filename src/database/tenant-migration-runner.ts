import { createTenantDataSource } from './tenant-data-source';

export async function runTenantMigrations(schemaName: string): Promise<void> {
  const dataSource = createTenantDataSource({ schema: schemaName });
  await dataSource.initialize();
  try {
    await dataSource.runMigrations();
  } finally {
    await dataSource.destroy();
  }
}
