import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CollectionPoint } from '../collection-point/entities/collection-point.entity';
import { Need } from '../need/entities/need.entity';
import {
  Organization,
  OrganizationStatus,
} from '../organization/entities/organization.entity';
import { Post } from '../post/entities/post.entity';
import { Supply } from '../supply/entities/supply.entity';
import { TenantConnectionService } from '../tenant/tenant-connection.service';
import {
  DEFAULT_PAGE_SIZE,
  ListPublicQueryDto,
  MAX_PAGE_SIZE,
} from './dto/list-public.query.dto';
import { PublicNeed } from './entities/public-need.entity';
import { isNeedClosed } from './public-mirror.service';

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

@Injectable()
export class PublicService {
  constructor(
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    @InjectRepository(PublicNeed)
    private readonly mirrorNeeds: Repository<PublicNeed>,
    private readonly tenantConnections: TenantConnectionService,
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
          SELECT 1 FROM "public"."public_needs" pn
          WHERE pn."organizationId" = o.id
            AND pn."closed" = false
            AND pn."supplyCategory" = :category
        )`,
        { category: query.category },
      );
    }

    const total = await base.clone().getCount();

    const rows = await base
      .clone()
      .leftJoin(
        PublicNeed,
        'n',
        'n."organizationId" = o.id AND n."closed" = false',
      )
      .select('o.id', 'id')
      .addSelect('o.name', 'name')
      .addSelect('o.description', 'description')
      .addSelect('o.address', 'address')
      .addSelect('o."logoUrl"', 'logoUrl')
      .addSelect('o."coverUrl"', 'coverUrl')
      .addSelect('COUNT(n.id)', 'openNeedsCount')
      .addSelect(
        `COALESCE(ARRAY_AGG(DISTINCT n."supplyCategory") FILTER (WHERE n.id IS NOT NULL), '{}')`,
        'categories',
      )
      .groupBy('o.id')
      .orderBy('COUNT(n.id)', 'DESC')
      .addOrderBy('o.name', 'ASC')
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .getRawMany<PublicOrgSummary & { openNeedsCount: string }>();

    return {
      items: rows.map((row) => ({
        ...row,
        openNeedsCount: Number(row.openNeedsCount),
        categories: row.categories ?? [],
      })),
      total,
      page,
      pageSize,
    };
  }

  /** Feed global de necesidades abiertas, servido desde el espejo. */
  async listNeeds(query: ListPublicQueryDto) {
    const { page, pageSize } = paging(query);

    const qb = this.mirrorNeeds
      .createQueryBuilder('n')
      .innerJoin(
        Organization,
        'o',
        'o.id = n."organizationId" AND o.status = :status',
        { status: OrganizationStatus.VALIDATED },
      )
      .where('n."closed" = false');

    if (query.category) {
      qb.andWhere('n."supplyCategory" = :category', {
        category: query.category,
      });
    }
    if (query.q) {
      qb.andWhere('(n."supplyName" ILIKE :q OR o.name ILIKE :q)', {
        q: `%${query.q}%`,
      });
    }

    const total = await qb.clone().getCount();

    const rows = await qb
      .clone()
      .select('n.id', 'id')
      .addSelect('n."organizationId"', 'organizationId')
      .addSelect('o.name', 'organizationName')
      .addSelect('o."logoUrl"', 'organizationLogoUrl')
      .addSelect('n."supplyName"', 'supplyName')
      .addSelect('n."supplyCategory"', 'supplyCategory')
      .addSelect('n."supplyUnit"', 'supplyUnit')
      .addSelect('n."requiredQuantity"', 'requiredQuantity')
      .addSelect('n."coveredQuantity"', 'coveredQuantity')
      .addSelect('n."deadline"', 'deadline')
      .orderBy('n."deadline"', 'ASC')
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .getRawMany();

    return {
      items: rows.map((row) => ({
        ...row,
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

  /**
   * Detalle de una organización: los datos públicos salen de `public`, y lo del
   * tenant se lee directo de su schema (una sola organización, sin fan-out).
   */
  async getOrganization(id: string) {
    const organization = await this.organizations.findOneBy({ id });
    if (!organization || organization.status !== OrganizationStatus.VALIDATED) {
      throw new NotFoundException('La organización no existe.');
    }

    const dataSource = await this.tenantConnections.getDataSource(id);
    const manager = dataSource.manager;

    const [needs, supplies, points, posts] = await Promise.all([
      manager.getRepository(Need).find(),
      manager.getRepository(Supply).find(),
      manager.getRepository(CollectionPoint).findBy({ active: true }),
      manager.getRepository(Post).find({
        order: { createdAt: 'DESC' },
        take: 5,
      }),
    ]);

    const supplyById = new Map(supplies.map((supply) => [supply.id, supply]));

    return {
      id: organization.id,
      name: organization.name,
      description: organization.description,
      address: organization.address,
      contact: organization.contact,
      logoUrl: organization.logoUrl,
      coverUrl: organization.coverUrl,
      needs: needs
        .filter((need) => !isNeedClosed(need) && supplyById.has(need.supplyId))
        .sort((a, b) => a.deadline.localeCompare(b.deadline))
        .map((need) => {
          const supply = supplyById.get(need.supplyId)!;
          return {
            id: need.id,
            supplyName: supply.name,
            supplyCategory: supply.category,
            supplyUnit: supply.unit,
            requiredQuantity: need.requiredQuantity,
            coveredQuantity: need.coveredQuantity,
            deadline: need.deadline,
          };
        }),
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
    };
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
