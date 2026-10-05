/* eslint-disable @typescript-eslint/unbound-method -- jest.fn() mocks are safe to reference unbound */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import {
  Supply,
  SupplyCategory,
  SupplyUnit,
} from '../supply/entities/supply.entity';
import { EventService } from '../event/event.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { Need, isNeedClosed } from './entities/need.entity';
import { NeedService } from './need.service';

function makeNeed(overrides: Partial<Need> = {}): Need {
  return {
    id: 'need-1',
    organizationId: 'org-1',
    supplyId: 'supply-1',
    requiredQuantity: 50,
    coveredQuantity: 0,
    deadline: '2099-08-01',
    closedManually: false,
    eventId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeSupply(overrides: Partial<Supply> = {}): Supply {
  return {
    id: 'supply-1',
    organizationId: 'org-1',
    name: 'Arroz',
    category: SupplyCategory.ALIMENTOS_SECOS,
    unit: SupplyUnit.KILOGRAMOS,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('NeedService', () => {
  let service: NeedService;
  let needRepo: jest.Mocked<Repository<Need>>;
  let supplyRepo: jest.Mocked<Repository<Supply>>;
  let tenantContext: jest.Mocked<TenantContextService>;
  let events: jest.Mocked<EventService>;

  beforeEach(() => {
    needRepo = {
      find: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn((data) => data as Need),
      save: jest.fn((entity) => Promise.resolve(entity as Need)),
    } as unknown as jest.Mocked<Repository<Need>>;
    supplyRepo = {
      findOneBy: jest.fn(),
    } as unknown as jest.Mocked<Repository<Supply>>;
    tenantContext = {
      organizationId: 'org-1',
      getManager: jest.fn().mockReturnValue({
        getRepository: (entity: unknown) =>
          entity === Supply ? supplyRepo : needRepo,
      }),
    } as unknown as jest.Mocked<TenantContextService>;
    events = {
      resolveLinkableId: jest.fn((id: string | null | undefined) =>
        Promise.resolve(id ?? null),
      ),
    } as unknown as jest.Mocked<EventService>;
    service = new NeedService(tenantContext, events);
  });

  describe('listMine', () => {
    it('returns every need of the organization', async () => {
      const needs = [makeNeed(), makeNeed({ id: 'need-2' })];
      needRepo.find.mockResolvedValue(needs);

      await expect(service.listMine()).resolves.toEqual(needs);
    });
  });

  describe('create', () => {
    it('creates a need when the supply exists', async () => {
      supplyRepo.findOneBy.mockResolvedValue(makeSupply());
      const dto = {
        supplyId: 'supply-1',
        requiredQuantity: 50,
        deadline: '2099-08-01',
      };

      const result = await service.create(dto);

      expect(result).toEqual({
        ...dto,
        organizationId: 'org-1',
        coveredQuantity: 0,
        closedManually: false,
        eventId: null,
      });
      expect(needRepo.save).toHaveBeenCalled();
    });

    it('asocia el evento validado por EventService', async () => {
      supplyRepo.findOneBy.mockResolvedValue(makeSupply());

      const result = await service.create({
        supplyId: 'supply-1',
        requiredQuantity: 50,
        deadline: '2099-08-01',
        eventId: 'event-1',
      });

      expect(events.resolveLinkableId).toHaveBeenCalledWith('event-1');
      expect(result.eventId).toBe('event-1');
    });

    it('no guarda si el evento no es asociable', async () => {
      supplyRepo.findOneBy.mockResolvedValue(makeSupply());
      events.resolveLinkableId.mockRejectedValue(new ConflictException());

      await expect(
        service.create({
          supplyId: 'supply-1',
          requiredQuantity: 50,
          deadline: '2099-08-01',
          eventId: 'event-baja',
        }),
      ).rejects.toThrow(ConflictException);
      expect(needRepo.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the supply does not exist', async () => {
      supplyRepo.findOneBy.mockResolvedValue(null);
      const dto = {
        supplyId: 'missing',
        requiredQuantity: 50,
        deadline: '2099-08-01',
      };

      await expect(service.create(dto)).rejects.toThrow(NotFoundException);
      expect(needRepo.save).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the deadline is in the past', async () => {
      supplyRepo.findOneBy.mockResolvedValue(makeSupply());
      const dto = {
        supplyId: 'supply-1',
        requiredQuantity: 50,
        deadline: '2000-01-01',
      };

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
      expect(needRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('conserva el evento actual al validar y permite desasociar', async () => {
      needRepo.findOneBy.mockResolvedValue(makeNeed({ eventId: 'event-1' }));
      supplyRepo.findOneBy.mockResolvedValue(makeSupply());

      const result = await service.update('need-1', {
        supplyId: 'supply-1',
        requiredQuantity: 50,
        deadline: '2099-08-01',
        eventId: null,
      });

      expect(events.resolveLinkableId).toHaveBeenCalledWith(null, 'event-1');
      expect(result.eventId).toBeNull();
    });

    it('throws NotFoundException when the need does not exist', async () => {
      needRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.update('missing-id', {
          supplyId: 'supply-1',
          requiredQuantity: 50,
          deadline: '2099-08-01',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when the need is closed manually', async () => {
      needRepo.findOneBy.mockResolvedValue(makeNeed({ closedManually: true }));

      await expect(
        service.update('need-1', {
          supplyId: 'supply-1',
          requiredQuantity: 50,
          deadline: '2099-08-01',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when the need is already completed', async () => {
      needRepo.findOneBy.mockResolvedValue(
        makeNeed({ coveredQuantity: 50, requiredQuantity: 50 }),
      );

      await expect(
        service.update('need-1', {
          supplyId: 'supply-1',
          requiredQuantity: 50,
          deadline: '2099-08-01',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException when moving the deadline to the past', async () => {
      needRepo.findOneBy.mockResolvedValue(makeNeed());

      await expect(
        service.update('need-1', {
          supplyId: 'supply-1',
          requiredQuantity: 50,
          deadline: '2000-01-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects editing an expired need without moving its deadline', async () => {
      needRepo.findOneBy.mockResolvedValue(
        makeNeed({ deadline: '2000-01-01' }),
      );
      supplyRepo.findOneBy.mockResolvedValue(makeSupply());

      await expect(
        service.update('need-1', {
          supplyId: 'supply-1',
          requiredQuantity: 80,
          deadline: '2000-01-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('reopens an expired need when the deadline moves to the future', async () => {
      needRepo.findOneBy.mockResolvedValue(
        makeNeed({ deadline: '2000-01-01' }),
      );
      supplyRepo.findOneBy.mockResolvedValue(makeSupply());

      const result = await service.update('need-1', {
        supplyId: 'supply-1',
        requiredQuantity: 80,
        deadline: '2099-09-01',
      });

      expect(result.deadline).toBe('2099-09-01');
      expect(isNeedClosed(result)).toBe(false);
    });

    it('updates an open need with a valid supply', async () => {
      needRepo.findOneBy.mockResolvedValue(makeNeed());
      supplyRepo.findOneBy.mockResolvedValue(makeSupply({ id: 'supply-2' }));

      const result = await service.update('need-1', {
        supplyId: 'supply-2',
        requiredQuantity: 80,
        deadline: '2099-09-01',
      });

      expect(result.supplyId).toBe('supply-2');
      expect(result.requiredQuantity).toBe(80);
      expect(result.deadline).toBe('2099-09-01');
    });
  });

  describe('updateProgress', () => {
    it('sets the covered quantity', async () => {
      needRepo.findOneBy.mockResolvedValue(makeNeed());

      const result = await service.updateProgress('need-1', {
        coveredQuantity: 30,
      });

      expect(result.coveredQuantity).toBe(30);
    });

    it('allows progress that completes the need', async () => {
      needRepo.findOneBy.mockResolvedValue(makeNeed({ requiredQuantity: 50 }));

      const result = await service.updateProgress('need-1', {
        coveredQuantity: 50,
      });

      expect(result.coveredQuantity).toBe(50);
    });

    it('throws ConflictException when the need is already closed', async () => {
      needRepo.findOneBy.mockResolvedValue(makeNeed({ closedManually: true }));

      await expect(
        service.updateProgress('need-1', { coveredQuantity: 10 }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when the need is expired', async () => {
      needRepo.findOneBy.mockResolvedValue(
        makeNeed({ deadline: '2000-01-01' }),
      );

      await expect(
        service.updateProgress('need-1', { coveredQuantity: 10 }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when the need does not exist', async () => {
      needRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.updateProgress('missing-id', { coveredQuantity: 10 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('close', () => {
    it('closes an open need manually', async () => {
      needRepo.findOneBy.mockResolvedValue(makeNeed());

      const result = await service.close('need-1');

      expect(result.closedManually).toBe(true);
    });

    it('throws ConflictException when already closed', async () => {
      needRepo.findOneBy.mockResolvedValue(makeNeed({ closedManually: true }));

      await expect(service.close('need-1')).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when already completed', async () => {
      needRepo.findOneBy.mockResolvedValue(
        makeNeed({ coveredQuantity: 50, requiredQuantity: 50 }),
      );

      await expect(service.close('need-1')).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when expired', async () => {
      needRepo.findOneBy.mockResolvedValue(
        makeNeed({ deadline: '2000-01-01' }),
      );

      await expect(service.close('need-1')).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when the need does not exist', async () => {
      needRepo.findOneBy.mockResolvedValue(null);

      await expect(service.close('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
