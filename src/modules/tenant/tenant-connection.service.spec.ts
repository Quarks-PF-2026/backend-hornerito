import { TenantConnectionService } from './tenant-connection.service';
import { createTenantDataSource } from '../../database/tenant-data-source';

jest.mock('../../database/tenant-data-source');

const createTenantDataSourceMock = createTenantDataSource as jest.Mock;

function makeFakeDataSource() {
  return {
    initialize: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
  };
}

describe('TenantConnectionService', () => {
  let service: TenantConnectionService;

  beforeEach(() => {
    createTenantDataSourceMock.mockReset();
    service = new TenantConnectionService();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('creates and caches a DataSource per organization', async () => {
    const fake = makeFakeDataSource();
    createTenantDataSourceMock.mockReturnValue(fake);

    const first = await service.getDataSource('org-1');
    const second = await service.getDataSource('org-1');

    expect(first).toBe(fake);
    expect(second).toBe(fake);
    expect(createTenantDataSourceMock).toHaveBeenCalledTimes(1);
    expect(fake.initialize).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent creation for the same organization', async () => {
    const fake = makeFakeDataSource();
    createTenantDataSourceMock.mockReturnValue(fake);

    const [a, b] = await Promise.all([
      service.getDataSource('org-2'),
      service.getDataSource('org-2'),
    ]);

    expect(a).toBe(fake);
    expect(b).toBe(fake);
    expect(createTenantDataSourceMock).toHaveBeenCalledTimes(1);
  });

  it('creates separate DataSources for different organizations', async () => {
    const fakeA = makeFakeDataSource();
    const fakeB = makeFakeDataSource();
    createTenantDataSourceMock
      .mockReturnValueOnce(fakeA)
      .mockReturnValueOnce(fakeB);

    const a = await service.getDataSource('org-a');
    const b = await service.getDataSource('org-b');

    expect(a).toBe(fakeA);
    expect(b).toBe(fakeB);
  });

  it('evicts a DataSource idle past the TTL', async () => {
    const fake = makeFakeDataSource();
    createTenantDataSourceMock.mockReturnValue(fake);
    await service.getDataSource('org-3');

    const cache = (
      service as unknown as {
        cache: Map<string, { lastUsedAt: number }>;
      }
    ).cache;
    cache.get('org-3')!.lastUsedAt = Date.now() - 31 * 60 * 1000;

    await (
      service as unknown as { evictIdle: () => Promise<void> }
    ).evictIdle();

    expect(fake.destroy).toHaveBeenCalledTimes(1);
    expect(cache.has('org-3')).toBe(false);
  });

  it('recreates a DataSource after eviction without error', async () => {
    const fake = makeFakeDataSource();
    createTenantDataSourceMock.mockReturnValue(fake);
    await service.getDataSource('org-4');

    const cache = (
      service as unknown as {
        cache: Map<string, { lastUsedAt: number }>;
      }
    ).cache;
    cache.get('org-4')!.lastUsedAt = Date.now() - 31 * 60 * 1000;
    await (
      service as unknown as { evictIdle: () => Promise<void> }
    ).evictIdle();

    const fake2 = makeFakeDataSource();
    createTenantDataSourceMock.mockReturnValue(fake2);
    const recreated = await service.getDataSource('org-4');

    expect(recreated).toBe(fake2);
  });
});
