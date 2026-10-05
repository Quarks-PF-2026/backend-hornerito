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
import { VolunteerType } from '../volunteer-type/entities/volunteer-type.entity';
import { VolunteerOpportunity } from '../volunteering/entities/volunteer-opportunity.entity';
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
    'distinct',
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
    resourceType: 'image',
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
    posts?: Partial<Post>[];
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
      find: () => Promise.resolve(options.posts ?? []),
    } as unknown as Repository<Post>;

    const opportunities = {
      createQueryBuilder: () => fakeQueryBuilder(options.rows ?? [], calls),
    } as unknown as Repository<VolunteerOpportunity>;

    const volunteerTypes = {
      find: () => Promise.resolve([]),
    } as unknown as Repository<VolunteerType>;

    return new PublicService(
      organizations,
      needs,
      media,
      collectionPoints,
      posts,
      opportunities,
      volunteerTypes,
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

  it('filtra por localidad exacta', async () => {
    const service = build({ rows: [] });
    await service.listOrganizations({ locality: 'Villa María' });
    expect(calls['andWhere:all']).toContainEqual([
      'o.locality = :locality',
      { locality: 'Villa María' },
    ]);
  });

  it('las localidades salen solo de organizaciones validadas y con localidad', async () => {
    const rows = [{ locality: 'Villa María', province: 'Córdoba' }];
    const service = build({ rows });
    await expect(service.listLocalities()).resolves.toEqual(rows);
    expect(calls.where).toEqual([
      'o.status = :status',
      { status: OrganizationStatus.VALIDATED },
    ]);
    expect(calls.andWhere).toEqual(['o.locality IS NOT NULL']);
  });

  it('no expone una organización que no está validada', async () => {
    const service = build({
      organization: { id: 'org-1', status: OrganizationStatus.PENDING },
    });
    await expect(service.getOrganization('org-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('el feed solo pide necesidades abiertas y no vencidas', async () => {
    const service = build({ rows: [] });
    await service.listNeeds({});
    expect(calls.where?.[0]).toBe(
      `n."closedManually" = false AND n."coveredQuantity" < n."requiredQuantity" AND n."deadline" >= (now() AT TIME ZONE 'America/Argentina/Cordoba')::date`,
    );
  });

  it('con withinDays pide solo las que vencen entre hoy y hoy + N, en fecha de Argentina', async () => {
    const service = build({ rows: [] });
    await service.listNeeds({ withinDays: 7 });
    const today = `(now() AT TIME ZONE 'America/Argentina/Cordoba')::date`;
    expect(calls['andWhere:all']).toContainEqual([
      `n."deadline" BETWEEN ${today} AND ${today} + CAST(:withinDays AS int)`,
      { withinDays: 7 },
    ]);
  });

  it('sin withinDays no recorta por fecha', async () => {
    const service = build({ rows: [] });
    await service.listNeeds({});
    expect(calls['andWhere:all']).toBeUndefined();
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
      `n."closedManually" = false AND n."coveredQuantity" < n."requiredQuantity" AND n."deadline" >= (now() AT TIME ZONE 'America/Argentina/Cordoba')::date`,
    );
    // El logo y la portada ya no se copian a `organizations`: salen de `media`.
    expect(detail.logoUrl).toBe('https://cdn/logo.png');
    expect(detail.coverUrl).toBe('https://cdn/cover.png');
  });

  it('en el detalle cada publicación trae sus adjuntos', async () => {
    const video: Media = {
      ...mediaRow('attachment', 'https://cdn/video.mp4'),
      id: 'media-video',
      ownerType: 'post',
      ownerId: 'post-1',
      resourceType: 'video',
    };
    const service = build({
      organization: { id: 'org-1', status: OrganizationStatus.VALIDATED },
      posts: [
        { id: 'post-1', title: 't', content: 'c' },
        { id: 'post-2', title: 't', content: 'c' },
      ],
      media: [mediaRow('logo', 'https://cdn/logo.png'), video],
    });

    const detail = await service.getOrganization('org-1');

    expect(detail.posts[0].media).toEqual([
      {
        id: 'media-video',
        url: 'https://cdn/video.mp4',
        resourceType: 'video',
        width: 1,
        height: 1,
      },
    ]);
    expect(detail.posts[1].media).toEqual([]);
  });
});
