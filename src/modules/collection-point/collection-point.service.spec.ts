/* eslint-disable @typescript-eslint/unbound-method -- jest.fn() mocks are safe to reference unbound */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { TenantContextService } from '../tenant/tenant-context.service';
import { CollectionPointService } from './collection-point.service';
import {
  CreateCollectionPointDto,
  ScheduleDayDto,
} from './dto/create-collection-point.dto';
import {
  CollectionPoint,
  ScheduleDay,
} from './entities/collection-point.entity';

function makeSchedule(
  overrides: Partial<ScheduleDay>[] = [],
): ScheduleDayDto[] {
  return Array.from({ length: 7 }, (_, day) => ({
    day,
    closed: day === 0,
    open: day === 0 ? null : '09:00',
    close: day === 0 ? null : '18:00',
    ...overrides[day],
  }));
}

function makeDto(
  overrides: Partial<CreateCollectionPointDto> = {},
): CreateCollectionPointDto {
  return {
    name: 'Sede central',
    addressLine: 'San Martín 100, Villa María',
    latitude: -32.4075,
    longitude: -63.2405,
    phone: '353 4123456',
    email: null,
    contactName: null,
    schedule: makeSchedule(),
    ...overrides,
  };
}

function makePoint(overrides: Partial<CollectionPoint> = {}): CollectionPoint {
  return {
    id: 'point-1',
    name: 'Sede central',
    addressLine: 'San Martín 100, Villa María',
    latitude: -32.4075,
    longitude: -63.2405,
    phone: '353 4123456',
    email: null,
    contactName: null,
    schedule: makeSchedule(),
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('CollectionPointService', () => {
  let service: CollectionPointService;
  let repo: jest.Mocked<Repository<CollectionPoint>>;

  beforeEach(() => {
    repo = {
      find: jest.fn(),
      findOne: jest.fn().mockResolvedValue(null),
      findOneBy: jest.fn(),
      create: jest.fn((data) => data as CollectionPoint),
      save: jest.fn(async (entity) => entity as CollectionPoint),
    } as unknown as jest.Mocked<Repository<CollectionPoint>>;
    const tenantContext = {
      getManager: jest.fn().mockResolvedValue({ getRepository: () => repo }),
    } as unknown as jest.Mocked<TenantContextService>;
    service = new CollectionPointService(tenantContext);
  });

  describe('create', () => {
    it('crea el punto activo', async () => {
      const created = await service.create(makeDto());

      expect(created.active).toBe(true);
      expect(created.name).toBe('Sede central');
      expect(repo.save).toHaveBeenCalled();
    });

    it('rechaza un nombre ya usado en la organización', async () => {
      repo.findOne.mockResolvedValue(makePoint({ id: 'otro' }));

      await expect(service.create(makeDto())).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('rechaza un día con cierre anterior o igual a la apertura', async () => {
      const schedule = makeSchedule();
      schedule[1] = { day: 1, closed: false, open: '18:00', close: '09:00' };

      await expect(
        service.create(makeDto({ schedule })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('rechaza un horario con todos los días cerrados', async () => {
      const schedule = makeSchedule(
        Array.from({ length: 7 }, (_, day) => ({
          day,
          closed: true,
          open: null,
          close: null,
        })),
      );

      await expect(
        service.create(makeDto({ schedule })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza un horario que no cubre los 7 días distintos', async () => {
      const schedule = makeSchedule();
      schedule[2] = { ...schedule[2], day: 1 };

      await expect(
        service.create(makeDto({ schedule })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update', () => {
    it('actualiza los datos del punto', async () => {
      repo.findOneBy.mockResolvedValue(makePoint());

      const updated = await service.update(
        'point-1',
        makeDto({ name: 'Sede norte' }),
      );

      expect(updated.name).toBe('Sede norte');
    });

    it('permite editar un punto inactivo', async () => {
      repo.findOneBy.mockResolvedValue(makePoint({ active: false }));

      const updated = await service.update(
        'point-1',
        makeDto({ addressLine: 'Sarmiento 250' }),
      );

      expect(updated.addressLine).toBe('Sarmiento 250');
      expect(updated.active).toBe(false);
    });

    it('no toma como duplicado su propio nombre', async () => {
      repo.findOneBy.mockResolvedValue(makePoint());
      repo.findOne.mockResolvedValue(makePoint());

      await expect(service.update('point-1', makeDto())).resolves.toBeDefined();
    });

    it('falla si el punto no existe', async () => {
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.update('nope', makeDto())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('deactivate / activate', () => {
    it('desactiva el punto', async () => {
      repo.findOneBy.mockResolvedValue(makePoint());

      await expect(service.deactivate('point-1')).resolves.toMatchObject({
        active: false,
      });
    });

    it('reactiva el punto', async () => {
      repo.findOneBy.mockResolvedValue(makePoint({ active: false }));

      await expect(service.activate('point-1')).resolves.toMatchObject({
        active: true,
      });
    });

    it('falla si el punto no existe', async () => {
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.deactivate('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('list', () => {
    it('lista los puntos del tenant, activos e inactivos', async () => {
      const points = [makePoint(), makePoint({ id: 'point-2', active: false })];
      repo.find.mockResolvedValue(points);

      await expect(service.list()).resolves.toEqual(points);
    });
  });
});
