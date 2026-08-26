import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CollectionPoint } from '../collection-point/entities/collection-point.entity';
import { Media } from '../media/entities/media.entity';
import { Need } from '../need/entities/need.entity';
import {
  Organization,
  OrganizationStatus,
} from '../organization/entities/organization.entity';
import { Post } from '../post/entities/post.entity';
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
  logoUrl: string | null;
  coverUrl: string | null;
  openNeedsCount: number;
  categories: string[];
}

/**
 * Una necesidad abierta: ni cerrada a mano ni ya cubierta. Se repite en SQL
 * porque el feed público lo resuelve la base, no el service.
 */
const OPEN_NEED = `n."closedManually" = false AND n."coveredQuantity" < n."requiredQuantity"`;

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
      .orderBy('n."deadline"', 'ASC')
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
    const [needs, points, posts, images, opportunities, volunteerTypes] =
      await Promise.all([
        this.needs
          .createQueryBuilder('n')
          .innerJoin(Supply, 's', 's.id = n."supplyId"')
          .where('n."organizationId" = :id', { id })
          .andWhere(OPEN_NEED)
          .select('n.id', 'id')
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
          }>(),
        this.collectionPoints.findBy({ organizationId: id, active: true }),
        this.posts.find({
          where: { organizationId: id },
          order: { createdAt: 'DESC' },
          take: 5,
        }),
        this.organizationImages([id]),
        organization.seeksVolunteers
          ? this.opportunities
              .createQueryBuilder('o')
              .leftJoin(
                VolunteerType,
                't',
                't.id = o."volunteerTypeId" AND t."organizationId" = o."organizationId"',
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
              }>()
          : Promise.resolve([]),
        organization.seeksVolunteers
          ? this.volunteerTypes.find({
              where: { organizationId: id, active: true },
              select: { id: true, name: true },
              order: { name: 'ASC' },
            })
          : Promise.resolve([]),
      ]);

    return {
      id: organization.id,
      name: organization.name,
      description: organization.description,
      address: organization.address,
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

function toIsoDate(value: Date | string): string {
  if (!(value instanceof Date)) {
    return value;
  }
  // Componentes locales, no `toISOString()`: pg entrega la fecha como
  // medianoche local, y pasarla a UTC la corre un día en husos al este.
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

function paging(query: ListPublicQueryDto): { page: number; pageSize: number } {
  return {
    page: query.page ?? 1,
    pageSize: Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
  };
}
