import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTenantDataSource } from '../../database/tenant-data-source';
import { TENANT_ENTITIES } from './tenant-entities';
import { schemaNameFor } from './tenant-schema.util';

const IDLE_EVICTION_MS = 30 * 60 * 1000;
const EVICTION_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const TENANT_POOL_SIZE = 3;

interface CachedDataSource {
  dataSource: DataSource;
  lastUsedAt: number;
}

@Injectable()
export class TenantConnectionService implements OnModuleDestroy {
  private readonly cache = new Map<string, CachedDataSource>();
  private readonly pending = new Map<string, Promise<DataSource>>();
  private readonly evictionTimer: NodeJS.Timeout;

  constructor() {
    this.evictionTimer = setInterval(
      () => void this.evictIdle(),
      EVICTION_CHECK_INTERVAL_MS,
    ).unref();
  }

  async getDataSource(organizationId: string): Promise<DataSource> {
    const cached = this.cache.get(organizationId);
    if (cached) {
      cached.lastUsedAt = Date.now();
      return cached.dataSource;
    }

    const inFlight = this.pending.get(organizationId);
    if (inFlight) {
      return inFlight;
    }

    const creation = this.createAndCache(organizationId);
    this.pending.set(organizationId, creation);
    try {
      return await creation;
    } finally {
      this.pending.delete(organizationId);
    }
  }

  private async createAndCache(organizationId: string): Promise<DataSource> {
    const dataSource = createTenantDataSource({
      schema: schemaNameFor(organizationId),
      poolSize: TENANT_POOL_SIZE,
      entities: TENANT_ENTITIES,
    });
    await dataSource.initialize();
    this.cache.set(organizationId, { dataSource, lastUsedAt: Date.now() });
    return dataSource;
  }

  private async evictIdle(): Promise<void> {
    const now = Date.now();
    for (const [organizationId, entry] of this.cache) {
      if (now - entry.lastUsedAt > IDLE_EVICTION_MS) {
        this.cache.delete(organizationId);
        await entry.dataSource.destroy().catch(() => undefined);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.evictionTimer);
    for (const entry of this.cache.values()) {
      await entry.dataSource.destroy().catch(() => undefined);
    }
    this.cache.clear();
  }
}
