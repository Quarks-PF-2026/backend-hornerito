import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runTenantMigrations } from '../../../database/tenant-migration-runner';
import { schemaNameFor } from '../../tenant/tenant-schema.util';

@Injectable()
export class TenantProvisioningService {
  private readonly logger = new Logger(TenantProvisioningService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async provision(organizationId: string): Promise<void> {
    const schemaName = schemaNameFor(organizationId);
    await this.dataSource.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
    try {
      await runTenantMigrations(schemaName);
    } catch (error) {
      this.logger.error(
        `Falló la migración del schema ${schemaName}, se revierte la creación.`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.dataSource.query(
        `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`,
      );
      throw error;
    }
  }
}
