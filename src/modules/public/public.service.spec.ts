import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { CollectionPoint } from '../collection-point/entities/collection-point.entity';
import { Media } from '../media/entities/media.entity';
import { Need } from '../need/entities/need.entity';
import {
  Organization,
  OrganizationStatus,
} from '../organization/entities/organization.entity';
import { Post } from '../post/entities/post.entity';
import { PublicService } from './public.service';

/** Query builder encadenable que registra los argumentos de cada método. */
function fakeQueryBuilder(rows: unknown[], calls: Record<string, unknown[]>) {
  const qb: Record<string, unknown> = {};
  const chain =
    (name: string) =>
    (...args: unknown[]) => {
      calls[name] = args;
      calls[`${name}:all`] ??= [];
      calls[`${name}:all`].push(args);
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

function mediaRow(purpose: string, url: string): Media {
  return {
    id: `media-${purpose}`,
    organizationId: 'org-1',
    ownerType: 'organization',
    ownerId: 'org-1',
    purpose,
    url,
    publicId: `p/${purpose}`,
    format: 'png',
    width: 1,
    height: 1,
    bytes: 1,
    createdBy: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('PublicService', () => {
  let calls: Record<string, unknown[]>;

  beforeEach(() => {
    calls = {};
  });

  function build(options: {
    organization?: Partial<Organization> | null;
    rows?: unknown[];
    media?: Media[];
  }) {
    const organizations = {
      createQueryBuilder: () => fakeQueryBuilder(options.rows ?? [], calls),
      findOneBy: () => Promise.resolve(options.organization ?? null),
    } as unknown as Repository<Organization>;

    const needs = {
      createQueryBuilder: () => fakeQueryBuilder(options.rows ?? [], calls),
    } as unknown as Repository<Need>;

    const media = {
      find: () => Promise.resolve(options.media ?? []),
    } as unknown as Repository<Media>;

    const collectionPoints = {
      findBy: () => Promise.resolve([]),
    } as unknown as Repository<CollectionPoint>;

    const posts = {
      find: () => Promise.resolve([]),
    } as unknown as Repository<Post>;

    return new PublicService(
      organizations,
      needs,
      media,
      collectionPoints,
      posts,
    );
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

  it('el feed solo pide necesidades abiertas', async () => {
    const service = build({ rows: [] });
    await service.listNeeds({});
    expect(calls.where?.[0]).toBe(
      'n."closedManually" = false AND n."coveredQuantity" < n."requiredQuantity"',
    );
  });

  it('en el detalle filtra por organización y necesidad abierta', async () => {
    const service = build({
      organization: {
        id: 'org-1',
        status: OrganizationStatus.VALIDATED,
        name: 'Comedor',
        description: 'd',
        address: 'a',
        contact: 'c',
      },
      media: [
        mediaRow('logo', 'https://cdn/logo.png'),
        mediaRow('cover', 'https://cdn/cover.png'),
      ],
    });

    const detail = await service.getOrganization('org-1');

    expect(calls.where).toEqual(['n."organizationId" = :id', { id: 'org-1' }]);
    expect(calls.andWhere?.[0]).toBe(
      'n."closedManually" = false AND n."coveredQuantity" < n."requiredQuantity"',
    );
    // El logo y la portada ya no se copian a `organizations`: salen de `media`.
    expect(detail.logoUrl).toBe('https://cdn/logo.png');
    expect(detail.coverUrl).toBe('https://cdn/cover.png');
  });
});
