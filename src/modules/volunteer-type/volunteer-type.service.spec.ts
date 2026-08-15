/* eslint-disable @typescript-eslint/unbound-method -- jest.fn() mocks are safe to reference unbound */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { TenantContextService } from '../tenant/tenant-context.service';
import { VolunteerType } from './entities/volunteer-type.entity';
import { VolunteerTypeService } from './volunteer-type.service';

function makeType(overrides: Partial<VolunteerType> = {}): VolunteerType {
  return {
    id: 'type-1',
    organizationId: 'org-1',
    name: 'Cocina',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('VolunteerTypeService', () => {
  let service: VolunteerTypeService;
  let repo: jest.Mocked<Repository<VolunteerType>>;
  let tenantContext: jest.Mocked<TenantContextService>;

  beforeEach(() => {
    repo = {
      find: jest.fn(),
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn((data) => data as VolunteerType),
      save: jest.fn(async (entity) => entity as VolunteerType),
    } as unknown as jest.Mocked<Repository<VolunteerType>>;
    tenantContext = {
      organizationId: 'org-1',
      getManager: jest.fn().mockReturnValue({ getRepository: () => repo }),
    } as unknown as jest.Mocked<TenantContextService>;
    service = new VolunteerTypeService(tenantContext);
  });

  describe('listMine', () => {
    it('returns every volunteer type of the organization', async () => {
      const types = [makeType(), makeType({ id: 'type-2', active: false })];
      repo.find.mockResolvedValue(types);

      await expect(service.listMine()).resolves.toEqual(types);
    });
  });

  describe('create', () => {
    it('creates a type when the name is available', async () => {
      repo.findOne.mockResolvedValue(null);

      const result = await service.create({ name: 'Huerta' });

      expect(result).toEqual({
        name: 'Huerta',
        organizationId: 'org-1',
        active: true,
      });
      expect(repo.save).toHaveBeenCalled();
    });

    it('rejects a duplicate name (case-insensitive)', async () => {
      repo.findOne.mockResolvedValue(makeType({ name: 'cocina' }));

      await expect(service.create({ name: 'Cocina' })).rejects.toThrow(
        ConflictException,
      );
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the type does not exist', async () => {
      repo.findOneBy.mockResolvedValue(null);

      await expect(
        service.update('missing-id', { name: 'Reparto' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('allows saving with its own unchanged name', async () => {
      repo.findOneBy.mockResolvedValue(makeType());
      // La búsqueda de duplicados excluye el propio id, así que no encuentra nada.
      repo.findOne.mockResolvedValue(null);

      const result = await service.update('type-1', { name: 'Cocina' });

      expect(result.name).toBe('Cocina');
      expect(repo.save).toHaveBeenCalled();
    });

    it('rejects renaming to a name already used by another type', async () => {
      repo.findOneBy.mockResolvedValue(makeType());
      repo.findOne.mockResolvedValue(
        makeType({ id: 'type-2', name: 'Reparto' }),
      );

      await expect(
        service.update('type-1', { name: 'Reparto' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('toggle', () => {
    it('deactivates an active type', async () => {
      repo.findOneBy.mockResolvedValue(makeType({ active: true }));

      await expect(service.toggle('type-1')).resolves.toMatchObject({
        active: false,
      });
    });

    it('reactivates an inactive type', async () => {
      repo.findOneBy.mockResolvedValue(makeType({ active: false }));

      await expect(service.toggle('type-1')).resolves.toMatchObject({
        active: true,
      });
    });

    it('throws NotFoundException when the type does not exist', async () => {
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.toggle('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
