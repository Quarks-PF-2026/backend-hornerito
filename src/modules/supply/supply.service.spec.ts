/* eslint-disable @typescript-eslint/unbound-method -- jest.fn() mocks are safe to reference unbound */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { PublicMirrorService } from '../public/public-mirror.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { Supply, SupplyCategory, SupplyUnit } from './entities/supply.entity';
import { SupplyService } from './supply.service';

function makeSupply(overrides: Partial<Supply> = {}): Supply {
  return {
    id: 'supply-1',
    name: 'Arroz',
    category: SupplyCategory.ALIMENTOS_SECOS,
    unit: SupplyUnit.KILOGRAMOS,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('SupplyService', () => {
  let service: SupplyService;
  let repo: jest.Mocked<Repository<Supply>>;
  let tenantContext: jest.Mocked<TenantContextService>;

  beforeEach(() => {
    repo = {
      find: jest.fn(),
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn((data) => data as Supply),
      save: jest.fn(async (entity) => entity as Supply),
    } as unknown as jest.Mocked<Repository<Supply>>;
    tenantContext = {
      getManager: jest
        .fn()
        .mockResolvedValue({ getRepository: () => repo }),
    } as unknown as jest.Mocked<TenantContextService>;
    service = new SupplyService(tenantContext, {
      syncSupply: jest.fn(),
    } as unknown as PublicMirrorService);
  });

  describe('listMine', () => {
    it('returns every supply in the tenant schema', async () => {
      const supplies = [makeSupply(), makeSupply({ id: 'supply-2', active: false })];
      repo.find.mockResolvedValue(supplies);

      await expect(service.listMine()).resolves.toEqual(supplies);
    });
  });

  describe('create', () => {
    it('creates a supply when the name is available', async () => {
      repo.findOne.mockResolvedValue(null);
      const dto = { name: 'Leche', category: SupplyCategory.FRESCOS, unit: SupplyUnit.LITROS };

      const result = await service.create(dto);

      expect(result).toEqual({ ...dto, active: true });
      expect(repo.save).toHaveBeenCalled();
    });

    it('rejects a duplicate name (case-insensitive)', async () => {
      repo.findOne.mockResolvedValue(makeSupply({ name: 'arroz' }));
      const dto = { name: 'Arroz', category: SupplyCategory.ALIMENTOS_SECOS, unit: SupplyUnit.KILOGRAMOS };

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the supply does not exist', async () => {
      repo.findOneBy.mockResolvedValue(null);

      await expect(
        service.update('missing-id', {
          name: 'Fideos',
          category: SupplyCategory.ALIMENTOS_SECOS,
          unit: SupplyUnit.PAQUETES,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('allows saving with its own unchanged name', async () => {
      const existing = makeSupply();
      repo.findOneBy.mockResolvedValue(existing);
      repo.findOne.mockResolvedValue(existing);

      const result = await service.update('supply-1', {
        name: 'Arroz',
        category: SupplyCategory.ALIMENTOS_SECOS,
        unit: SupplyUnit.KILOGRAMOS,
      });

      expect(result.name).toBe('Arroz');
      expect(repo.save).toHaveBeenCalled();
    });

    it('rejects renaming to a name already used by another supply', async () => {
      const existing = makeSupply();
      repo.findOneBy.mockResolvedValue(existing);
      repo.findOne.mockResolvedValue(makeSupply({ id: 'supply-2', name: 'Leche' }));

      await expect(
        service.update('supply-1', {
          name: 'Leche',
          category: SupplyCategory.FRESCOS,
          unit: SupplyUnit.LITROS,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('toggle', () => {
    it('deactivates an active supply', async () => {
      repo.findOneBy.mockResolvedValue(makeSupply({ active: true }));

      const result = await service.toggle('supply-1');

      expect(result.active).toBe(false);
    });

    it('reactivates an inactive supply', async () => {
      repo.findOneBy.mockResolvedValue(makeSupply({ active: false }));

      const result = await service.toggle('supply-1');

      expect(result.active).toBe(true);
    });

    it('throws NotFoundException when the supply does not exist', async () => {
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.toggle('missing-id')).rejects.toThrow(NotFoundException);
    });
  });
});
