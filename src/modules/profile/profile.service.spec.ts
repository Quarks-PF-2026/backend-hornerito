import { Repository } from 'typeorm';
import type { IUserRepository } from '../auth/repositories/user-repository.interface';
import { DonationKind } from '../donation/entities/donation.entity';
import {
  MonetaryDonation,
  MonetaryDonationStatus,
} from '../donation/entities/monetary-donation.entity';
import { ProfileService } from './profile.service';

/** Query builder encadenable que registra los argumentos de cada método. */
function fakeQueryBuilder(rows: unknown[], calls: Record<string, unknown[][]>) {
  const qb: Record<string, unknown> = {};
  for (const method of [
    'where',
    'andWhere',
    'innerJoin',
    'select',
    'addSelect',
    'orderBy',
    'addOrderBy',
    'limit',
  ]) {
    qb[method] = (...args: unknown[]) => {
      (calls[method] ??= []).push(args);
      return qb;
    };
  }
  qb.getRawMany = () => Promise.resolve(rows);
  return qb;
}

describe('ProfileService — Mis donaciones (QK-113)', () => {
  const createdAt = new Date('2026-11-10T12:00:00.000Z');
  let calls: Record<string, unknown[][]>;
  let service: ProfileService;

  beforeEach(() => {
    calls = {};
    const rows = [
      {
        id: 'don-1',
        organizationId: 'org-1',
        organizationName: 'Comedor Los Pibes',
        amount: '5000.00',
        status: MonetaryDonationStatus.DECLARADA,
        isAnonymous: true,
        createdAt,
      },
    ];
    const donations = {
      createQueryBuilder: () => fakeQueryBuilder(rows, calls),
    } as unknown as Repository<MonetaryDonation>;
    service = new ProfileService({} as IUserRepository, donations);
  });

  describe('Dado un donante con sesión, cuando entra a "Mis donaciones"', () => {
    it('entonces se filtra por el usuario del JWT y solo económicas', async () => {
      await service.listMyDonations('user-ana');

      const filters = [...(calls.where ?? []), ...(calls.andWhere ?? [])].map(
        (args) => args[1],
      );
      expect(filters).toContainEqual({ userId: 'user-ana' });
      expect(filters).toContainEqual({ kind: DonationKind.ECONOMICA });
    });

    it('entonces ve el monto como número y la fecha en ISO', async () => {
      const [donation] = await service.listMyDonations('user-ana');

      expect(donation).toEqual({
        id: 'don-1',
        organizationId: 'org-1',
        organizationName: 'Comedor Los Pibes',
        amount: 5000,
        status: MonetaryDonationStatus.DECLARADA,
        isAnonymous: true,
        createdAt: '2026-11-10T12:00:00.000Z',
      });
    });
  });
});
