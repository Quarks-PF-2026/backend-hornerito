import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CollectionPoint } from '../collection-point/entities/collection-point.entity';
import { Need } from '../need/entities/need.entity';
import {
  Supply,
  SupplyCategory,
  SupplyUnit,
} from '../supply/entities/supply.entity';
import { TenantContextService } from '../tenant/tenant-context.service';
import { DonationService } from './donation.service';
import { CreateDonationDto } from './dto/create-donation.dto';
import { DonationItem } from './entities/donation-item.entity';
import { InPersonDonation } from './entities/in-person-donation.entity';

function makeNeed(overrides: Partial<Need> = {}): Need {
  return {
    id: 'need-1',
    organizationId: 'org-1',
    supplyId: 'supply-1',
    requiredQuantity: 50,
    coveredQuantity: 0,
    deadline: '2026-08-01',
    closedManually: false,
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

function dtoWith(
  overrides: Partial<CreateDonationDto> = {},
): CreateDonationDto {
  return {
    items: [{ supplyId: 'supply-1', needId: 'need-1', quantity: 10 }],
    ...overrides,
  };
}

/** Lo que el service le pasa a `.set()`: expresiones SQL, no valores. */
type SetArg = { coveredQuantity: () => string; updatedAt: () => string };

describe('DonationService', () => {
  let service: DonationService;
  let donationRepo: { create: jest.Mock; save: jest.Mock; find: jest.Mock };
  let itemRepo: { create: jest.Mock; save: jest.Mock; find: jest.Mock };
  let needRepo: { findOneBy: jest.Mock };
  let supplyRepo: { findOneBy: jest.Mock };
  let pointRepo: { findOneBy: jest.Mock };
  /** Espía del UPDATE que acredita la cobertura. */
  let updateBuilder: {
    update: jest.Mock;
    set: jest.Mock<unknown, [SetArg]>;
    where: jest.Mock;
    setParameter: jest.Mock;
    execute: jest.Mock;
  };

  beforeEach(() => {
    let savedId = 0;
    donationRepo = {
      create: jest.fn(
        (data: Partial<InPersonDonation>) =>
          ({ ...data, id: 'donation-1' }) as InPersonDonation,
      ),
      save: jest.fn((entity: InPersonDonation) => Promise.resolve(entity)),
      find: jest.fn(),
    };
    itemRepo = {
      create: jest.fn(
        (data: Partial<DonationItem>) =>
          ({ ...data, id: `item-${++savedId}` }) as DonationItem,
      ),
      save: jest.fn((entities: DonationItem[]) => Promise.resolve(entities)),
      find: jest.fn(),
    };
    needRepo = { findOneBy: jest.fn().mockResolvedValue(makeNeed()) };
    supplyRepo = { findOneBy: jest.fn().mockResolvedValue(makeSupply()) };
    pointRepo = { findOneBy: jest.fn() };

    updateBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn<unknown, [SetArg]>().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === InPersonDonation) return donationRepo;
        if (entity === DonationItem) return itemRepo;
        if (entity === Need) return needRepo;
        if (entity === Supply) return supplyRepo;
        if (entity === CollectionPoint) return pointRepo;
        throw new Error('unexpected entity');
      },
      createQueryBuilder: jest.fn(() => updateBuilder),
      // La transacción del request corre sobre el mismo manager.
      transaction: (cb: (trx: unknown) => unknown) => cb(manager),
    };

    const tenantContext = {
      organizationId: 'org-1',
      getManager: jest.fn().mockReturnValue(manager),
    } as unknown as jest.Mocked<TenantContextService>;

    service = new DonationService(tenantContext);
  });

  describe('create', () => {
    it('registers the donation and credits the associated need', async () => {
      const result = await service.create(
        dtoWith({
          donorName: '  Ana  ',
          items: [
            { supplyId: 'supply-1', needId: 'need-1', quantity: 10 },
            { supplyId: 'supply-1', needId: null, quantity: 4 },
          ],
        }),
      );

      expect(result.items).toHaveLength(2);
      expect(result.donorName).toBe('Ana');
      // Solo el ítem con necesidad mueve el progreso.
      expect(updateBuilder.execute).toHaveBeenCalledTimes(1);
      expect(updateBuilder.setParameter).toHaveBeenCalledWith('quantity', 10);
    });

    it('caps the coverage at the required quantity', async () => {
      await service.create(dtoWith());

      const setArg = updateBuilder.set.mock.calls[0][0];
      expect(setArg.coveredQuantity()).toBe(
        'LEAST("requiredQuantity", "coveredQuantity" + :quantity)',
      );
    });

    it('does not touch any need when no item has one', async () => {
      const result = await service.create(
        dtoWith({ items: [{ supplyId: 'supply-1', quantity: 3 }] }),
      );

      expect(result.items[0].needId).toBeNull();
      expect(updateBuilder.execute).not.toHaveBeenCalled();
    });

    it('stores an anonymous donor when the name is empty', async () => {
      const result = await service.create(
        dtoWith({ donorName: '   ', donorContact: '' }),
      );

      expect(result.donorName).toBeNull();
      expect(result.donorContact).toBeNull();
    });

    it('throws NotFoundException when the supply does not exist', async () => {
      supplyRepo.findOneBy.mockResolvedValue(null);

      await expect(service.create(dtoWith())).rejects.toThrow(
        NotFoundException,
      );
      expect(donationRepo.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the need does not exist', async () => {
      needRepo.findOneBy.mockResolvedValue(null);

      await expect(service.create(dtoWith())).rejects.toThrow(
        NotFoundException,
      );
      expect(donationRepo.save).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the need is already closed', async () => {
      needRepo.findOneBy.mockResolvedValue(makeNeed({ closedManually: true }));

      await expect(service.create(dtoWith())).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws ConflictException when the need is already covered', async () => {
      needRepo.findOneBy.mockResolvedValue(makeNeed({ coveredQuantity: 50 }));

      await expect(service.create(dtoWith())).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws BadRequestException when the item supply differs from the need supply', async () => {
      supplyRepo.findOneBy.mockResolvedValue(makeSupply({ id: 'supply-2' }));
      needRepo.findOneBy.mockResolvedValue(makeNeed({ supplyId: 'supply-1' }));

      await expect(
        service.create(
          dtoWith({
            items: [{ supplyId: 'supply-2', needId: 'need-1', quantity: 5 }],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the collection point does not exist', async () => {
      pointRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.create(dtoWith({ collectionPointId: 'missing-point' })),
      ).rejects.toThrow(NotFoundException);
    });

    it('accepts a donation without a collection point', async () => {
      const result = await service.create(dtoWith());

      expect(result.collectionPointId).toBeNull();
      expect(pointRepo.findOneBy).not.toHaveBeenCalled();
    });
  });

  describe('listMine', () => {
    it('groups the items of each donation', async () => {
      donationRepo.find.mockResolvedValue([
        {
          id: 'donation-1',
          collectionPointId: null,
          donorName: 'Ana',
          donorContact: null,
          createdAt: new Date(),
        },
        {
          id: 'donation-2',
          collectionPointId: null,
          donorName: null,
          donorContact: null,
          createdAt: new Date(),
        },
      ]);
      itemRepo.find.mockResolvedValue([
        {
          id: 'item-1',
          donationId: 'donation-1',
          supplyId: 'supply-1',
          needId: 'need-1',
          quantity: 10,
        },
        {
          id: 'item-2',
          donationId: 'donation-1',
          supplyId: 'supply-2',
          needId: null,
          quantity: 2,
        },
        {
          id: 'item-3',
          donationId: 'donation-2',
          supplyId: 'supply-1',
          needId: null,
          quantity: 5,
        },
      ]);

      const result = await service.listMine();

      expect(result[0].items).toHaveLength(2);
      expect(result[1].items).toHaveLength(1);
    });

    it('skips the items query when there are no donations', async () => {
      donationRepo.find.mockResolvedValue([]);

      await expect(service.listMine()).resolves.toEqual([]);
      expect(itemRepo.find).not.toHaveBeenCalled();
    });
  });
});
