import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { CollectionPoint } from '../collection-point/entities/collection-point.entity';
import { Need } from '../need/entities/need.entity';
import {
  Organization,
  OrganizationStatus,
} from '../organization/entities/organization.entity';
import { Post } from '../post/entities/post.entity';
import { Supply, SupplyCategory, SupplyUnit } from '../supply/entities/supply.entity';
import { TenantConnectionService } from '../tenant/tenant-connection.service';
import { PublicNeed } from './entities/public-need.entity';
import { PublicService } from './public.service';

/** Query builder encadenable que registra los límites usados. */
function fakeQueryBuilder(rows: unknown[], calls: Record<string, unknown>) {
  const qb: Record<string, unknown> = {};
  const chain = (name: string) => (...args: unknown[]) => {
    calls[name] = args;
    return qb;
  };
  for (const method of [
    'where',
    'andWhere',
    'leftJoin',
    'innerJoin',
    'select',
    'addSelect',
    'groupBy',
    'orderBy',
    'addOrderBy',
    'limit',
    'offset',
  ]) {
    qb[method] = chain(method);
  }
  qb.clone = () => qb;
  qb.getCount = () => Promise.resolve(rows.length);
  qb.getRawMany = () => Promise.resolve(rows);
  return qb;
}

function supply(id: string): Supply {
  return {
    id,
    name: 'Arroz',
    category: SupplyCategory.ALIMENTOS_SECOS,
    unit: SupplyUnit.KILOGRAMOS,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function need(overrides: Partial<Need>): Need {
  return {
    id: 'need-1',
    supplyId: 'supply-1',
    requiredQuantity: 10,
    coveredQuantity: 0,
    deadline: '2026-09-01',
    closedManually: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('PublicService', () => {
  const calls: Record<string, unknown> = {};

  function build(options: {
    organization?: Partial<Organization> | null;
    needs?: Need[];
    rows?: unknown[];
  }) {
    const organizations = {
      createQueryBuilder: () => fakeQueryBuilder(options.rows ?? [], calls),
      findOneBy: () => Promise.resolve(options.organization ?? null),
    } as unknown as Repository<Organization>;

    const mirrorNeeds = {
      createQueryBuilder: () => fakeQueryBuilder(options.rows ?? [], calls),
    } as unknown as Repository<PublicNeed>;

    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === Need) return { find: () => Promise.resolve(options.needs ?? []) };
        if (entity === Supply) return { find: () => Promise.resolve([supply('supply-1')]) };
        if (entity === CollectionPoint) return { findBy: () => Promise.resolve([]) };
        if (entity === Post) return { find: () => Promise.resolve([]) };
        throw new Error('entidad inesperada');
      },
    };

    const tenantConnections = {
      getDataSource: () => Promise.resolve({ manager }),
    } as unknown as TenantConnectionService;

    return new PublicService(organizations, mirrorNeeds, tenantConnections);
  }

  it('recorta el pageSize al máximo permitido', async () => {
    const service = build({ rows: [] });
    await service.listOrganizations({ pageSize: 500, page: 3 });
    expect(calls.limit).toEqual([24]);
    expect(calls.offset).toEqual([48]);
  });

  it('filtra por texto libre sobre nombre, descripción y dirección', async () => {
    const service = build({ rows: [] });
    await service.listOrganizations({ q: 'comedor' });
    expect(calls.andWhere).toEqual([
      '(o.name ILIKE :q OR o.description ILIKE :q OR o.address ILIKE :q)',
      { q: '%comedor%' },
    ]);
  });

  it('no expone una organización que no está validada', async () => {
    const service = build({
      organization: { id: 'org-1', status: OrganizationStatus.PENDING },
    });
    await expect(service.getOrganization('org-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('en el detalle deja solo las necesidades abiertas', async () => {
    const service = build({
      organization: {
        id: 'org-1',
        status: OrganizationStatus.VALIDATED,
        name: 'Comedor',
        description: 'd',
        address: 'a',
        contact: 'c',
        logoUrl: null,
        coverUrl: null,
      },
      needs: [
        need({ id: 'abierta' }),
        need({ id: 'cerrada-a-mano', closedManually: true }),
        need({ id: 'cubierta', coveredQuantity: 10 }),
      ],
    });

    const detail = await service.getOrganization('org-1');

    expect(detail.needs.map((item) => item.id)).toEqual(['abierta']);
    expect(detail.needs[0].supplyName).toBe('Arroz');
  });
});
