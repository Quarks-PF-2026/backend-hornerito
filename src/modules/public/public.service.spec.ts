import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { CollectionPoint } from '../collection-point/entities/collection-point.entity';
import { OrgEvent } from '../event/entities/event.entity';
import { DonationKind } from '../donation/entities/donation.entity';
import {
  MonetaryDonation,
  MonetaryDonationStatus,
} from '../donation/entities/monetary-donation.entity';
import { Media } from '../media/entities/media.entity';
import { Need } from '../need/entities/need.entity';
import {
  Organization,
  OrganizationStatus,
} from '../organization/entities/organization.entity';
import { Post } from '../post/entities/post.entity';
import { Story } from '../story/entities/story.entity';
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
    'setParameters',
  ]) {
    qb[method] = chain(method);
  }
  qb.clone = () => qb;
  qb.getCount = () => Promise.resolve(rows.length);
  qb.getRawMany = () => Promise.resolve(rows);
  qb.getMany = () => Promise.resolve(rows);
  qb.getRawOne = () => Promise.resolve(rows[0]);
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
  let eventCalls: Record<string, unknown[]>;
  let donationCalls: Record<string, unknown[]>;
  let storyCalls: Record<string, unknown[]>;
  let storyInsert: Record<string, jest.Mock>;
  let storyViewsFind: jest.Mock;

  beforeEach(() => {
    storyCalls = {};
    storyViewsFind = jest.fn();
    storyInsert = {};
    for (const method of ['insert', 'into', 'values', 'orIgnore']) {
      storyInsert[method] = jest.fn(() => storyInsert);
    }
    storyInsert.execute = jest.fn().mockResolvedValue(undefined);
    calls = {};
    eventCalls = {};
    donationCalls = {};
  });

  function build(options: {
    organization?: Partial<Organization> | null;
    rows?: unknown[];
    media?: Media[];
    posts?: Partial<Post>[];
    events?: Partial<OrgEvent>[];
    donationRows?: unknown[];
    stories?: Partial<Story>[];
    storyOrgs?: Partial<Organization>[];
    seenStoryIds?: string[];
  }) {
    const organizations = {
      createQueryBuilder: () => fakeQueryBuilder(options.rows ?? [], calls),
      findOneBy: () => Promise.resolve(options.organization ?? null),
      find: () => Promise.resolve(options.storyOrgs ?? []),
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

    const events = {
      createQueryBuilder: () =>
        fakeQueryBuilder(options.events ?? [], eventCalls),
    } as unknown as Repository<OrgEvent>;

    const donations = {
      createQueryBuilder: () =>
        fakeQueryBuilder(options.donationRows ?? [], donationCalls),
    } as unknown as Repository<MonetaryDonation>;

    const stories = {
      createQueryBuilder: () =>
        fakeQueryBuilder(options.stories ?? [], storyCalls),
      manager: {
        createQueryBuilder: () => storyInsert,
        find: storyViewsFind.mockResolvedValue(
          (options.seenStoryIds ?? []).map((storyId) => ({ storyId })),
        ),
      },
    } as unknown as Repository<Story>;

    return new PublicService(
      organizations,
      needs,
      media,
      collectionPoints,
      posts,
      opportunities,
      volunteerTypes,
      events,
      donations,
      stories,
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

  it('el detalle lista solo eventos activos y no pasados, con fecha ISO', async () => {
    const service = build({
      organization: {
        id: 'org-1',
        status: OrganizationStatus.VALIDATED,
        name: 'Comedor',
        description: 'd',
        address: 'a',
        contact: 'c',
      },
      events: [
        {
          id: 'event-1',
          name: 'Merienda',
          kind: 'periodic' as OrgEvent['kind'],
          startDate: '2026-09-01',
          weekdays: [2],
          startTime: '17:00',
          active: false,
        },
      ],
    });

    const detail = await service.getOrganization('org-1');

    expect(detail.events).toEqual([
      {
        id: 'event-1',
        name: 'Merienda',
        kind: 'periodic',
        startDate: '2026-09-01',
        weekdays: [2],
        startTime: '17:00',
      },
    ]);
    const eventFilters = (eventCalls['andWhere:all'] as unknown[][]).map(
      (a) => a[0],
    );
    expect(eventFilters).toContain('e."active" = true');
    expect(
      eventFilters.some((f) => String(f).includes('e."startDate" >=')),
    ).toBe(true);
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

  describe('ranking y perfil de donantes (DOMAIN.md §17)', () => {
    const validatedOrg = (overrides: Partial<Organization> = {}) => ({
      id: 'org-1',
      status: OrganizationStatus.VALIDATED,
      ...overrides,
    });

    /** Condiciones `where`/`andWhere` que recibió el query builder de donaciones. */
    const donationFilters = () => [
      donationCalls.where,
      ...((donationCalls['andWhere:all'] as unknown[][] | undefined) ?? []),
    ];

    it('solo cuentan las económicas confirmadas, de una cuenta, no anónimas, a organizaciones validadas', async () => {
      await build({}).topDonors();

      expect(donationCalls['innerJoin:all']).toContainEqual([
        Organization,
        'o',
        'o.id = d."organizationId" AND o.status = :validated',
        { validated: OrganizationStatus.VALIDATED },
      ]);
      expect(donationFilters()).toEqual(
        expect.arrayContaining([
          ['d."kind" = :kind', { kind: DonationKind.ECONOMICA }],
          [
            'd."status" = :confirmed',
            { confirmed: MonetaryDonationStatus.CONFIRMADA },
          ],
          ['d."donorUserId" IS NOT NULL'],
          ['d."isAnonymous" = false'],
        ]),
      );
    });

    it('suma solo el mes en curso en hora de Argentina, por fecha de declaración', async () => {
      await build({}).topDonors();

      const month = (donationCalls['andWhere:all'] as unknown[][]).find((c) =>
        String(c[0]).includes('createdAt'),
      );
      expect(month?.[0]).toBe(
        'd."createdAt" >= :monthFrom AND d."createdAt" < :monthTo',
      );
      const { monthFrom, monthTo } = month?.[1] as Record<string, string>;
      // Literales UTC del día 1 a las 00:00 AR: la columna no tiene zona.
      expect(monthFrom).toMatch(/^\d{4}-\d{2}-01 03:00:00\.000$/);
      expect(monthTo).toMatch(/^\d{4}-\d{2}-01 03:00:00\.000$/);
    });

    it('ante un empate de monto queda arriba quien llegó antes a ese total, y después el nombre', async () => {
      await build({}).topDonors();

      expect(donationCalls.orderBy).toEqual(['SUM(d.amount)', 'DESC']);
      expect(donationCalls['addOrderBy:all']).toEqual([
        ['MAX(d."createdAt")', 'ASC'],
        ['u.name', 'ASC'],
        ['u.id', 'ASC'],
      ]);
    });

    it('el global muestra hasta 10 sin recortar por organización', async () => {
      await build({}).topDonors();

      expect(donationCalls.limit).toEqual([10]);
      expect(
        donationFilters().some((c) =>
          String(c?.[0]).includes('organizationId'),
        ),
      ).toBe(false);
    });

    it('el de una organización recorta por ella y muestra hasta 5', async () => {
      await build({}).topDonors('org-1');

      expect(donationCalls.limit).toEqual([5]);
      expect(donationCalls['andWhere:all']).toContainEqual([
        'd."organizationId" = :organizationId',
        { organizationId: 'org-1' },
      ]);
    });

    it('numera las posiciones y castea los montos, sin contacto', async () => {
      const service = build({
        donationRows: [
          { userId: 'user-beto', name: 'Beto Ruiz', total: '8000.00' },
          { userId: 'user-ana', name: 'Ana Pérez', total: '3000.00' },
        ],
      });

      await expect(service.topDonors()).resolves.toEqual([
        { position: 1, userId: 'user-beto', name: 'Beto Ruiz', total: 8000 },
        { position: 2, userId: 'user-ana', name: 'Ana Pérez', total: 3000 },
      ]);
      const selected = [
        donationCalls.select,
        ...(donationCalls['addSelect:all'] as unknown[][]),
      ].map((c) => String(c[0]));
      expect(selected.join(' ')).not.toMatch(/email|phone|donorContact|o\./);
    });

    it('la ficha con datos de cobro trae su top', async () => {
      const service = build({
        organization: validatedOrg({ paymentAlias: 'comedor.pibes' }),
        donationRows: [
          { userId: 'user-ana', name: 'Ana Pérez', total: '5000' },
        ],
      });

      const detail = await service.getOrganization('org-1');

      expect(detail.topDonors).toEqual([
        { position: 1, userId: 'user-ana', name: 'Ana Pérez', total: 5000 },
      ]);
      expect(donationCalls.limit).toEqual([5]);
    });

    it('la ficha sin datos de cobro no muestra top ni lo consulta', async () => {
      const service = build({
        organization: validatedOrg({ paymentAlias: null }),
        donationRows: [
          { userId: 'user-ana', name: 'Ana Pérez', total: '5000' },
        ],
      });

      const detail = await service.getOrganization('org-1');

      expect(detail.topDonors).toEqual([]);
      expect(donationCalls.limit).toBeUndefined();
    });

    it('el perfil devuelve nombre, alta y totales del mes e históricos, con las mismas reglas', async () => {
      const service = build({
        donationRows: [
          {
            userId: 'user-ana',
            name: 'Ana Pérez',
            memberSince: new Date('2025-03-15T15:00:00.000Z'),
            monthTotal: '3000.00',
            totalAmount: '5000.00',
          },
        ],
      });

      await expect(service.getDonor('user-ana')).resolves.toEqual({
        userId: 'user-ana',
        name: 'Ana Pérez',
        memberSince: '2025-03-15T15:00:00.000Z',
        monthTotal: 3000,
        totalAmount: 5000,
      });
      expect(donationFilters()).toEqual(
        expect.arrayContaining([
          ['d."isAnonymous" = false'],
          ['d."donorUserId" = :userId', { userId: 'user-ana' }],
        ]),
      );
    });

    it('una cuenta sin donaciones públicas confirmadas no tiene perfil', async () => {
      await expect(build({}).getDonor('user-ana')).rejects.toThrow(
        new NotFoundException('El donante no existe.'),
      );
    });
  });

  describe('historias (QK-111)', () => {
    const story = (id: string, organizationId: string, minute: number) => ({
      id,
      organizationId,
      mediaUrl: `https://res.cloudinary.com/demo/${id}.jpg`,
      mediaType: 'image',
      durationSec: null,
      text: null,
      linkUrl: null,
      createdAt: new Date(Date.UTC(2026, 10, 8, 12, minute)),
      expiresAt: new Date(Date.UTC(2026, 10, 15, 12, minute)),
    });
    const storyFilters = () => (storyCalls['andWhere:all'] ?? []).flat();

    it('agrupa por organización y ordena las organizaciones por su historia más reciente', async () => {
      const service = build({
        // Ya vienen de la base ordenadas por createdAt ASC.
        stories: [
          story('a1', 'org-a', 0),
          story('b1', 'org-b', 1),
          story('a2', 'org-a', 2),
          story('b2', 'org-b', 3),
        ] as Partial<Story>[],
        storyOrgs: [
          { id: 'org-a', name: 'Comedor A' },
          { id: 'org-b', name: 'Comedor B' },
        ],
      });

      const groups = await service.listStories();

      expect(
        groups.map((g) => [g.organizationName, g.stories.map((s) => s.id)]),
      ).toEqual([
        ['Comedor B', ['b1', 'b2']],
        ['Comedor A', ['a1', 'a2']],
      ]);
      expect(storyCalls.where).toEqual(['s."deletedAt" IS NULL']);
      expect(storyFilters()).toContain('s."expiresAt" > now()');
      expect(storyCalls.innerJoin?.[2]).toContain('o.status = :validated');
    });

    describe('Dado que Ana tiene cuenta y vio todas las de Comedor B y una de Comedor A', () => {
      const options = {
        stories: [
          story('a1', 'org-a', 0),
          story('b1', 'org-b', 1),
          story('a2', 'org-a', 2),
          story('b2', 'org-b', 3),
        ] as Partial<Story>[],
        storyOrgs: [
          { id: 'org-a', name: 'Comedor A' },
          { id: 'org-b', name: 'Comedor B' },
        ],
        seenStoryIds: ['a1', 'b1', 'b2'],
      };

      it('Entonces sigue viendo todas, cada una marcada como vista o no, y Comedor B pasa al final', async () => {
        const groups = await build(options).listStories('user-ana');

        expect(
          groups.map((g) => [
            g.organizationName,
            g.stories.map((s) => [s.id, s.seen]),
          ]),
        ).toEqual([
          [
            'Comedor A',
            [
              ['a1', true],
              ['a2', false],
            ],
          ],
          [
            'Comedor B',
            [
              ['b1', true],
              ['b2', true],
            ],
          ],
        ]);
        expect(storyFilters().join(' ')).not.toContain('story_views');
      });

      it('Entonces un visitante sin cuenta las ve todas sin ver y no se consultan vistas', async () => {
        const groups = await build(options).listStories();

        expect(groups.map((g) => g.organizationName)).toEqual([
          'Comedor B',
          'Comedor A',
        ]);
        expect(groups.flatMap((g) => g.stories).every((s) => !s.seen)).toBe(
          true,
        );
        expect(storyViewsFind).not.toHaveBeenCalled();
      });
    });

    it('registrar una vista sin sesión no escribe nada', async () => {
      await build({}).viewStory('story-1');
      expect(storyInsert.execute).not.toHaveBeenCalled();
    });

    it('registrar la vista de una historia inexistente o no vigente da 404', async () => {
      await expect(build({}).viewStory('story-1', 'user-ana')).rejects.toThrow(
        NotFoundException,
      );
      expect(storyInsert.execute).not.toHaveBeenCalled();
    });

    it('la vista toma la organización de la historia y es idempotente', async () => {
      await build({
        stories: [story('story-1', 'org-a', 0)] as Partial<Story>[],
      }).viewStory('story-1', 'user-ana');
      expect(storyInsert.values).toHaveBeenCalledWith({
        storyId: 'story-1',
        userId: 'user-ana',
        organizationId: 'org-a',
      });
      expect(storyInsert.orIgnore).toHaveBeenCalled();
    });
  });
});
