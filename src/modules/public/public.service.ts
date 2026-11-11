import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TODAY_AR, toIsoDate } from '../../common/today-ar';
import { AccountType, User } from '../auth/entities/user.entity';
import { CollectionPoint } from '../collection-point/entities/collection-point.entity';
import { currentMonthRange, utcLiteral } from '../donation/date-range';
import { DonationKind } from '../donation/entities/donation.entity';
import {
  MonetaryDonation,
  MonetaryDonationStatus,
} from '../donation/entities/monetary-donation.entity';
import { EventKind, OrgEvent } from '../event/entities/event.entity';
import { Media } from '../media/entities/media.entity';
import { mediaByOwner } from '../media/media.service';
import { Need } from '../need/entities/need.entity';
import {
  Organization,
  OrganizationStatus,
} from '../organization/entities/organization.entity';
import { Post } from '../post/entities/post.entity';
import { StoryView } from '../story/entities/story-view.entity';
import { Story } from '../story/entities/story.entity';
import { StoryDto, toStoryDto } from '../story/story.service';
import { Supply } from '../supply/entities/supply.entity';
import { VolunteerType } from '../volunteer-type/entities/volunteer-type.entity';
import { VolunteerOpportunity } from '../volunteering/entities/volunteer-opportunity.entity';
import {
  DEFAULT_PAGE_SIZE,
  ListPublicQueryDto,
  MAX_PAGE_SIZE,
} from './dto/list-public.query.dto';

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PublicOrgSummary {
  id: string;
  name: string;
  description: string;
  address: string;
  /** Ubicación normalizada (QK-112). Null en las que todavía no la cargaron. */
  locality: string | null;
  province: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  openNeedsCount: number;
  categories: string[];
}

/** Una organización en la barra de historias del inicio (QK-111). */
export interface PublicStoryGroup {
  organizationId: string;
  organizationName: string;
  organizationLogoUrl: string | null;
  /** `seen`: si quien mira ya la abrió; el visitante sin cuenta, siempre `false`. */
  stories: (StoryDto & { seen: boolean })[];
}

export interface PublicLocality {
  locality: string;
  province: string | null;
}

/** Una fila del ranking de donantes. Nunca lleva contacto (invariante 18). */
export interface DonorRankingRow {
  position: number;
  userId: string;
  name: string;
  total: number;
}

export interface PublicDonorProfile {
  userId: string;
  name: string;
  /** Alta de la cuenta, ISO. El front muestra mes y año. */
  memberSince: string;
  monthTotal: number;
  totalAmount: number;
}

/** Top global del inicio (QK-114) y top de la ficha (QK-115), DOMAIN.md §17. */
const GLOBAL_TOP_DONORS = 10;
const ORGANIZATION_TOP_DONORS = 5;

/**
 * Mes en curso sobre la fecha de declaración: una donación confirmada después
 * suma en el mes en que se declaró. Los extremos viajan como literales UTC
 * (`utcLiteral`) porque `createdAt` es `TIMESTAMP` sin zona.
 */
const IN_CURRENT_MONTH = `d."createdAt" >= :monthFrom AND d."createdAt" < :monthTo`;

/**
 * Una necesidad abierta: ni cerrada a mano, ni cubierta, ni vencida. Mismo
 * criterio que `isNeedClosed`, repetido en SQL porque el feed público lo
 * resuelve la base, no el service.
 */
const OPEN_NEED = `n."closedManually" = false AND n."coveredQuantity" < n."requiredQuantity" AND n."deadline" >= ${TODAY_AR}`;

/**
 * El mismo criterio que `isOpportunityOpen`, pero en SQL: la ficha pública no
 * puede ofrecer para postularse una actividad cerrada, cancelada o sin cupos.
 * Vive acá y no duplicado en cada query para que las dos lecturas no se
 * desincronicen.
 */
const OPEN_OPPORTUNITY = `o."status" = 'open' AND o."acceptedCount" < o."capacity"`;

/**
 * Directorio público: es el único lugar que lee entre organizaciones. Corre
 * como owner (sin `SET ROLE`), así que RLS no aplica; el recorte lo hace el
 * filtro por `status = validated` de cada query.
 */
@Injectable()
export class PublicService {
  constructor(
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    @InjectRepository(Need)
    private readonly needs: Repository<Need>,
    @InjectRepository(Media)
    private readonly media: Repository<Media>,
    @InjectRepository(CollectionPoint)
    private readonly collectionPoints: Repository<CollectionPoint>,
    @InjectRepository(Post)
    private readonly posts: Repository<Post>,
    @InjectRepository(VolunteerOpportunity)
    private readonly opportunities: Repository<VolunteerOpportunity>,
    @InjectRepository(VolunteerType)
    private readonly volunteerTypes: Repository<VolunteerType>,
    @InjectRepository(OrgEvent)
    private readonly events: Repository<OrgEvent>,
    @InjectRepository(MonetaryDonation)
    private readonly donations: Repository<MonetaryDonation>,
    @InjectRepository(Story)
    private readonly stories: Repository<Story>,
  ) {}

  async listOrganizations(
    query: ListPublicQueryDto,
  ): Promise<Page<PublicOrgSummary>> {
    const { page, pageSize } = paging(query);

    const base = this.organizations
      .createQueryBuilder('o')
      .where('o.status = :status', { status: OrganizationStatus.VALIDATED });

    if (query.q) {
      base.andWhere(
        '(o.name ILIKE :q OR o.description ILIKE :q OR o.address ILIKE :q)',
        { q: `%${query.q}%` },
      );
    }

    if (query.locality) {
      base.andWhere('o.locality = :locality', { locality: query.locality });
    }

    if (query.category) {
      base.andWhere(
        `EXISTS (
          SELECT 1 FROM "needs" n
          JOIN "supplies" s ON s.id = n."supplyId"
          WHERE n."organizationId" = o.id AND ${OPEN_NEED}
            AND s."category" = :category
        )`,
        { category: query.category },
      );
    }

    const total = await base.clone().getCount();

    const rows = await base
      .clone()
      .leftJoin(Need, 'n', `n."organizationId" = o.id AND ${OPEN_NEED}`)
      .leftJoin(Supply, 's', 's.id = n."supplyId"')
      .select('o.id', 'id')
      .addSelect('o.name', 'name')
      .addSelect('o.description', 'description')
      .addSelect('o.address', 'address')
      .addSelect('o.locality', 'locality')
      .addSelect('o.province', 'province')
      .addSelect('COUNT(n.id)', 'openNeedsCount')
      // `::text` no es cosmético: node-pg no sabe parsear un array de un tipo
      // enum propio y devolvería el literal `{...}` de Postgres como string.
      .addSelect(
        `COALESCE(ARRAY_AGG(DISTINCT s."category"::text) FILTER (WHERE n.id IS NOT NULL), '{}')`,
        'categories',
      )
      .groupBy('o.id')
      .orderBy('COUNT(n.id)', 'DESC')
      .addOrderBy('o.name', 'ASC')
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .getRawMany<
        Omit<PublicOrgSummary, 'openNeedsCount' | 'logoUrl' | 'coverUrl'> & {
          openNeedsCount: string;
        }
      >();

    const images = await this.organizationImages(rows.map((row) => row.id));

    return {
      items: rows.map((row) => ({
        ...row,
        openNeedsCount: Number(row.openNeedsCount),
        categories: row.categories ?? [],
        logoUrl: images.get(row.id)?.logo ?? null,
        coverUrl: images.get(row.id)?.cover ?? null,
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Localidades con al menos una organización validada, para el filtro del
   * inicio (QK-109): el visitante solo elige entre las que dan resultados.
   * ponytail: sin paginar; buscar/paginar si algún día son cientos.
   */
  listLocalities(): Promise<PublicLocality[]> {
    return this.organizations
      .createQueryBuilder('o')
      .select('o.locality', 'locality')
      .addSelect('o.province', 'province')
      .distinct(true)
      .where('o.status = :status', { status: OrganizationStatus.VALIDATED })
      .andWhere('o.locality IS NOT NULL')
      .orderBy('o.locality', 'ASC')
      .addOrderBy('o.province', 'ASC')
      .getRawMany<PublicLocality>();
  }

  /** Feed global de necesidades abiertas de organizaciones validadas. */
  async listNeeds(query: ListPublicQueryDto) {
    const { page, pageSize } = paging(query);

    const qb = this.needs
      .createQueryBuilder('n')
      .innerJoin(Supply, 's', 's.id = n."supplyId"')
      .innerJoin(
        Organization,
        'o',
        'o.id = n."organizationId" AND o.status = :status',
        { status: OrganizationStatus.VALIDATED },
      )
      .where(OPEN_NEED);

    if (query.category) {
      qb.andWhere('s."category" = :category', { category: query.category });
    }
    if (query.q) {
      qb.andWhere('(s."name" ILIKE :q OR o.name ILIKE :q)', {
        q: `%${query.q}%`,
      });
    }
    if (query.withinDays) {
      qb.andWhere(
        `n."deadline" BETWEEN ${TODAY_AR} AND ${TODAY_AR} + CAST(:withinDays AS int)`,
        { withinDays: query.withinDays },
      );
    }

    const total = await qb.clone().getCount();

    const rows = await qb
      .clone()
      .select('n.id', 'id')
      .addSelect('n."organizationId"', 'organizationId')
      .addSelect('o.name', 'organizationName')
      .addSelect('s."name"', 'supplyName')
      .addSelect('s."category"', 'supplyCategory')
      .addSelect('s."unit"', 'supplyUnit')
      .addSelect('n."requiredQuantity"', 'requiredQuantity')
      .addSelect('n."coveredQuantity"', 'coveredQuantity')
      .addSelect('n."deadline"', 'deadline')
      // Lo más urgente primero; entre las que vencen el mismo día, la menos
      // cubierta (más relevante). n.id cierra el orden: sin una clave única,
      // LIMIT/OFFSET puede repetir o saltear filas entre páginas del carrusel.
      // NULLIF: requiredQuantity > 0 lo valida el DTO, no un CHECK en la base.
      .orderBy('n."deadline"', 'ASC')
      .addOrderBy(
        'CAST(n."coveredQuantity" AS float) / NULLIF(n."requiredQuantity", 0)',
        'ASC',
      )
      .addOrderBy('n.id', 'ASC')
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .getRawMany<{
        id: string;
        organizationId: string;
        organizationName: string;
        supplyName: string;
        supplyCategory: string;
        supplyUnit: string;
        requiredQuantity: string;
        coveredQuantity: string;
        deadline: Date | string;
      }>();

    const images = await this.organizationImages(
      rows.map((row) => row.organizationId),
    );

    return {
      items: rows.map((row) => ({
        ...row,
        organizationLogoUrl: images.get(row.organizationId)?.logo ?? null,
        requiredQuantity: Number(row.requiredQuantity),
        coveredQuantity: Number(row.coveredQuantity),
        // `getRawMany` devuelve las columnas `date` como Date; el front espera
        // el mismo 'YYYY-MM-DD' que sirve el resto de la API.
        deadline: toIsoDate(row.deadline),
      })),
      total,
      page,
      pageSize,
    };
  }

  /** Detalle de una organización validada. */
  async getOrganization(id: string) {
    const organization = await this.organizations.findOneBy({ id });
    if (!organization || organization.status !== OrganizationStatus.VALIDATED) {
      throw new NotFoundException('La organización no existe.');
    }

    // Las lecturas de voluntariado corren después de la guarda de arriba, así
    // que una organización pending o rejected no expone nada de esto.
    const [
      needs,
      points,
      posts,
      images,
      postMedia,
      opportunities,
      volunteerTypes,
      events,
      topDonors,
      stories,
    ] = await Promise.all([
      this.needs
        .createQueryBuilder('n')
        .innerJoin(Supply, 's', 's.id = n."supplyId"')
        .leftJoin(
          OrgEvent,
          'e',
          'e.id = n."eventId" AND e."organizationId" = n."organizationId"',
        )
        .where('n."organizationId" = :id', { id })
        .andWhere(OPEN_NEED)
        .select('n.id', 'id')
        .addSelect('n."eventId"', 'eventId')
        .addSelect('e."name"', 'eventName')
        .addSelect('s."name"', 'supplyName')
        .addSelect('s."category"', 'supplyCategory')
        .addSelect('s."unit"', 'supplyUnit')
        .addSelect('n."requiredQuantity"', 'requiredQuantity')
        .addSelect('n."coveredQuantity"', 'coveredQuantity')
        .addSelect('n."deadline"', 'deadline')
        .orderBy('n."deadline"', 'ASC')
        .getRawMany<{
          id: string;
          supplyName: string;
          supplyCategory: string;
          supplyUnit: string;
          requiredQuantity: string;
          coveredQuantity: string;
          deadline: Date | string;
          eventId: string | null;
          eventName: string | null;
        }>(),
      this.collectionPoints.findBy({ organizationId: id, active: true }),
      this.posts.find({
        where: { organizationId: id },
        order: { createdAt: 'DESC' },
        take: 5,
      }),
      this.organizationImages([id]),
      // Todos los adjuntos de la organización, no solo los de las 5 últimas
      // publicaciones: ahorra encadenar una segunda query, y son pocos por
      // publicación (máximo 4).
      // ponytail: trae adjuntos de publicaciones viejas que no se muestran;
      // filtrar por los ids de `posts` si la organización acumula cientos.
      this.media
        .find({
          where: {
            organizationId: id,
            ownerType: 'post',
            purpose: 'attachment',
          },
          order: { createdAt: 'ASC' },
        })
        .then(mediaByOwner),
      organization.seeksVolunteers
        ? this.opportunities
            .createQueryBuilder('o')
            .leftJoin(
              VolunteerType,
              't',
              't.id = o."volunteerTypeId" AND t."organizationId" = o."organizationId"',
            )
            .leftJoin(
              OrgEvent,
              'e',
              'e.id = o."eventId" AND e."organizationId" = o."organizationId"',
            )
            .where('o."organizationId" = :id', { id })
            .andWhere(OPEN_OPPORTUNITY)
            .select('o.id', 'id')
            .addSelect('o."title"', 'title')
            .addSelect('o."description"', 'description')
            .addSelect('o."startsAt"', 'startsAt')
            .addSelect('o."location"', 'location')
            .addSelect('o."capacity"', 'capacity')
            .addSelect('o."acceptedCount"', 'acceptedCount')
            .addSelect('o."volunteerTypeId"', 'volunteerTypeId')
            .addSelect('t."name"', 'volunteerTypeName')
            .addSelect('o."eventId"', 'eventId')
            .addSelect('e."name"', 'eventName')
            .orderBy('o."startsAt"', 'ASC')
            .getRawMany<{
              id: string;
              title: string;
              description: string;
              startsAt: Date;
              location: string;
              capacity: string;
              acceptedCount: string;
              volunteerTypeId: string | null;
              volunteerTypeName: string | null;
              eventId: string | null;
              eventName: string | null;
            }>()
        : Promise.resolve([]),
      organization.seeksVolunteers
        ? this.volunteerTypes.find({
            where: { organizationId: id, active: true },
            select: { id: true, name: true },
            order: { name: 'ASC' },
          })
        : Promise.resolve([]),
      // Activos; un extraordinario ya pasado no se ofrece.
      this.events
        .createQueryBuilder('e')
        .where('e."organizationId" = :id', { id })
        .andWhere('e."active" = true')
        .andWhere(`(e."kind" = :periodic OR e."startDate" >= ${TODAY_AR})`, {
          periodic: EventKind.PERIODIC,
        })
        .orderBy('e."name"', 'ASC')
        .getMany(),
      // Mismo criterio que `donations.acceptsMonetary`: sin datos de cobro no
      // hay sección de donar, y tampoco top (DOMAIN.md §17).
      organization.paymentAlias
        ? this.topDonors(id)
        : Promise.resolve<DonorRankingRow[]>([]),
      // Todas las vigentes, vistas o no: el perfil no se personaliza.
      this.liveStories({ organizationId: id }),
    ]);

    return {
      id: organization.id,
      name: organization.name,
      description: organization.description,
      address: organization.address,
      locality: organization.locality,
      province: organization.province,
      contact: organization.contact,
      logoUrl: images.get(id)?.logo ?? null,
      coverUrl: images.get(id)?.cover ?? null,
      needs: needs.map((need) => ({
        ...need,
        requiredQuantity: Number(need.requiredQuantity),
        coveredQuantity: Number(need.coveredQuantity),
        deadline: toIsoDate(need.deadline),
      })),
      collectionPoints: points.map((point) => ({
        id: point.id,
        name: point.name,
        addressLine: point.addressLine,
        latitude: point.latitude,
        longitude: point.longitude,
        phone: point.phone,
        schedule: point.schedule,
      })),
      posts: posts.map((post) => ({
        id: post.id,
        title: post.title,
        content: post.content,
        createdAt: post.createdAt,
        media: postMedia.get(post.id) ?? [],
      })),
      // Los datos bancarios son públicos a propósito: son el destino de la
      // transferencia, y sin ellos el donante no puede donar (QK-20).
      donations: {
        acceptsMonetary: Boolean(organization.paymentAlias),
        alias: organization.paymentAlias,
        holder: organization.paymentHolder,
        cuit: organization.paymentCuit,
        bank: organization.paymentBank,
      },
      topDonors,
      stories: stories.map(toStoryDto),
      events: events.map((event) => ({
        id: event.id,
        name: event.name,
        kind: event.kind,
        startDate: toIsoDate(event.startDate),
        weekdays: event.weekdays,
        startTime: event.startTime,
      })),
      volunteering: {
        seeksVolunteers: organization.seeksVolunteers,
        types: volunteerTypes.map((type) => ({
          id: type.id,
          name: type.name,
        })),
        opportunities: opportunities.map((opportunity) => ({
          ...opportunity,
          capacity: Number(opportunity.capacity),
          acceptedCount: Number(opportunity.acceptedCount),
        })),
      },
    };
  }

  /**
   * Barra de historias del inicio (DOMAIN.md §18, regla del 2026-11-10).
   * Siempre todas las vigentes, también con cuenta: cada una dice si el
   * usuario ya la vio, y las organizaciones con alguna sin ver van primero
   * (las ya vistas enteras, al final). Dentro de cada bloque, la de historia
   * más reciente primero; dentro de cada organización, de la más vieja a la
   * más nueva (el orden en que se reproducen).
   */
  async listStories(viewerId?: string): Promise<PublicStoryGroup[]> {
    const stories = await this.liveStories({});
    const seen = await this.seenStoryIds(stories, viewerId);
    const byOrg = new Map<string, Story[]>();
    for (const story of stories) {
      byOrg.set(story.organizationId, [
        ...(byOrg.get(story.organizationId) ?? []),
        story,
      ]);
    }
    const orgIds = [...byOrg.keys()];
    if (orgIds.length === 0) {
      return [];
    }

    const [organizations, images] = await Promise.all([
      this.organizations.find({
        where: { id: In(orgIds), status: OrganizationStatus.VALIDATED },
        select: { id: true, name: true },
      }),
      this.organizationImages(orgIds),
    ]);
    const names = new Map(organizations.map((o) => [o.id, o.name]));

    const latest = (list: Story[]) => list[list.length - 1].createdAt.getTime();
    const allSeen = (list: Story[]) => list.every((s) => seen.has(s.id));
    return [...byOrg.entries()]
      .filter(([orgId]) => names.has(orgId))
      .sort(
        ([, a], [, b]) =>
          Number(allSeen(a)) - Number(allSeen(b)) || latest(b) - latest(a),
      )
      .map(([orgId, list]) => ({
        organizationId: orgId,
        organizationName: names.get(orgId)!,
        organizationLogoUrl: images.get(orgId)?.logo ?? null,
        stories: list.map((s) => ({ ...toStoryDto(s), seen: seen.has(s.id) })),
      }));
  }

  /**
   * Cuáles de estas historias ya abrió el usuario. Cruza organizaciones a
   * propósito (la barra muestra varias, §10): no hay un `organizationId` que
   * fijar, y el acotamiento lo dan el propio `userId` y los ids, que ya pasaron
   * por `liveStories`. Sin cuenta no se registran vistas: el set queda vacío.
   */
  private async seenStoryIds(
    stories: Story[],
    viewerId?: string,
  ): Promise<Set<string>> {
    if (!viewerId || stories.length === 0) {
      return new Set();
    }
    const views = await this.stories.manager.find(StoryView, {
      where: { userId: viewerId, storyId: In(stories.map((s) => s.id)) },
      select: { storyId: true },
    });
    return new Set(views.map((v) => v.storyId));
  }

  /**
   * Marca una historia como vista. El visitante sin cuenta no deja rastro
   * (DOMAIN.md §18). Corre como owner, sin tenant: la existencia, vigencia y
   * organización validada se verifican antes de insertar, y el
   * `organizationId` de la vista sale de la historia, no del cliente.
   */
  async viewStory(storyId: string, viewerId?: string): Promise<void> {
    if (!viewerId) {
      return;
    }
    const [story] = await this.liveStories({ storyId });
    if (!story) {
      throw new NotFoundException('La historia no existe.');
    }
    // PK (storyId, userId): volver a abrirla no duplica.
    await this.stories.manager
      .createQueryBuilder()
      .insert()
      .into(StoryView)
      .values({
        storyId: story.id,
        userId: viewerId,
        organizationId: story.organizationId,
      })
      .orIgnore()
      .execute();
  }

  /**
   * Única definición de "historia visible al público": vigente, no eliminada
   * y de una organización validada. Corre como owner y `stories` no tiene
   * `FORCE ROW LEVEL SECURITY`, así que cada condición va explícita.
   */
  private liveStories(filter: {
    organizationId?: string;
    storyId?: string;
  }): Promise<Story[]> {
    const qb = this.stories
      .createQueryBuilder('s')
      .innerJoin(
        Organization,
        'o',
        'o.id = s."organizationId" AND o.status = :validated',
        { validated: OrganizationStatus.VALIDATED },
      )
      .where('s."deletedAt" IS NULL')
      .andWhere('s."expiresAt" > now()');
    if (filter.organizationId) {
      qb.andWhere('s."organizationId" = :organizationId', {
        organizationId: filter.organizationId,
      });
    }
    if (filter.storyId) {
      qb.andWhere('s.id = :storyId', { storyId: filter.storyId });
    }
    return qb.orderBy('s."createdAt"', 'ASC').getMany();
  }

  /**
   * Ranking mensual de donantes: global (top 10, QK-114) o de una organización
   * (top 5, QK-115). Desempate: a igual monto queda arriba quien llegó antes a
   * ese total, o sea el de última donación sumada más vieja; después, el
   * nombre. El `userId` final no es regla de negocio: solo garantiza el mismo
   * orden en cada request si coinciden nombre y hora.
   */
  async topDonors(organizationId?: string): Promise<DonorRankingRow[]> {
    const qb = this.countedDonations()
      .andWhere(IN_CURRENT_MONTH, currentMonth())
      .select('u.id', 'userId')
      .addSelect('u.name', 'name')
      .addSelect('SUM(d.amount)', 'total')
      .groupBy('u.id')
      .orderBy('SUM(d.amount)', 'DESC')
      .addOrderBy('MAX(d."createdAt")', 'ASC')
      .addOrderBy('u.name', 'ASC')
      .addOrderBy('u.id', 'ASC')
      .limit(organizationId ? ORGANIZATION_TOP_DONORS : GLOBAL_TOP_DONORS);
    if (organizationId) {
      qb.andWhere('d."organizationId" = :organizationId', { organizationId });
    }

    const rows = await qb.getRawMany<{
      userId: string;
      name: string;
      total: string;
    }>();
    return rows.map((row, index) => ({
      position: index + 1,
      userId: row.userId,
      name: row.name,
      total: Number(row.total),
    }));
  }

  /**
   * Perfil público de un donante (QK-110): mismas reglas de suma que el
   * ranking. Sin ninguna donación que cuente no hay perfil, aunque la cuenta
   * exista: desde afuera no se distingue de un usuario inexistente.
   */
  async getDonor(userId: string): Promise<PublicDonorProfile> {
    const row = await this.countedDonations()
      .andWhere('d."donorUserId" = :userId', { userId })
      .select('u.id', 'userId')
      .addSelect('u.name', 'name')
      .addSelect('u."createdAt"', 'memberSince')
      .addSelect(
        `COALESCE(SUM(d.amount) FILTER (WHERE ${IN_CURRENT_MONTH}), 0)`,
        'monthTotal',
      )
      .addSelect('SUM(d.amount)', 'totalAmount')
      .setParameters(currentMonth())
      .groupBy('u.id')
      .getRawOne<{
        userId: string;
        name: string;
        memberSince: Date;
        monthTotal: string;
        totalAmount: string;
      }>();
    if (!row) {
      throw new NotFoundException('El donante no existe.');
    }
    return {
      userId: row.userId,
      name: row.name,
      memberSince: new Date(row.memberSince).toISOString(),
      monthTotal: Number(row.monthTotal),
      totalAmount: Number(row.totalAmount),
    };
  }

  /**
   * Las donaciones que suman en el ranking y en el perfil, DOMAIN.md §17:
   * económicas, confirmadas, de una cuenta, no anónimas y a una organización
   * validada. Es la única definición: las dos lecturas parten de acá.
   *
   * Corre como owner y `donations` no tiene `FORCE ROW LEVEL SECURITY`, así que
   * la policy no recorta nada (ver AddDonorUser): cada condición está escrita
   * explícita, incluida la variante, aunque el repositorio de la entidad hija ya
   * filtre por discriminador. Solo se joinea `users` por el nombre y el alta;
   * email y teléfono nunca se seleccionan.
   */
  private countedDonations() {
    return (
      this.donations
        .createQueryBuilder('d')
        .innerJoin(
          Organization,
          'o',
          'o.id = d."organizationId" AND o.status = :validated',
          { validated: OrganizationStatus.VALIDATED },
        )
        // Solo cuentas donante: las donaciones previas a la separación de tipos
        // pueden traer el id de una cuenta que la migración pasó a organización,
        // y esa cuenta nunca figura en el ranking ni tiene perfil (DOMAIN §17).
        .innerJoin(
          User,
          'u',
          'u.id = d."donorUserId" AND u."accountType" = :donor',
          {
            donor: AccountType.DONOR,
          },
        )
        .where('d."kind" = :kind', { kind: DonationKind.ECONOMICA })
        .andWhere('d."status" = :confirmed', {
          confirmed: MonetaryDonationStatus.CONFIRMADA,
        })
        .andWhere('d."donorUserId" IS NOT NULL')
        .andWhere('d."isAnonymous" = false')
    );
  }

  /** Logo y portada de cada organización, leídos de `media`. */
  private async organizationImages(
    organizationIds: string[],
  ): Promise<Map<string, { logo?: string; cover?: string }>> {
    const images = new Map<string, { logo?: string; cover?: string }>();
    if (organizationIds.length === 0) {
      return images;
    }

    const rows = await this.media.find({
      where: organizationIds.map((organizationId) => ({
        organizationId,
        ownerType: 'organization',
      })),
      select: { organizationId: true, purpose: true, url: true },
    });

    for (const row of rows) {
      if (row.purpose !== 'logo' && row.purpose !== 'cover') {
        continue;
      }
      const entry = images.get(row.organizationId) ?? {};
      entry[row.purpose] = row.url;
      images.set(row.organizationId, entry);
    }
    return images;
  }
}

function paging(query: ListPublicQueryDto): { page: number; pageSize: number } {
  return {
    page: query.page ?? 1,
    pageSize: Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
  };
}

function currentMonth(): { monthFrom: string; monthTo: string } {
  const { from, to } = currentMonthRange(new Date());
  return { monthFrom: utcLiteral(from), monthTo: utcLiteral(to) };
}
