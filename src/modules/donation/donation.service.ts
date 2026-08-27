import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { CollectionPoint } from '../collection-point/entities/collection-point.entity';
import { Need, isNeedClosed } from '../need/entities/need.entity';
import { Supply } from '../supply/entities/supply.entity';
import { TenantContextService } from '../tenant/tenant-context.service';
import { DateRange, createdAtWithin } from './date-range';
import { CreateDonationDto } from './dto/create-donation.dto';
import { DonationItem } from './entities/donation-item.entity';
import { InPersonDonation } from './entities/in-person-donation.entity';

export interface DonationResponse {
  id: string;
  collectionPointId: string | null;
  donorName: string | null;
  donorContact: string | null;
  createdAt: Date;
  items: {
    id: string;
    supplyId: string;
    needId: string | null;
    quantity: number;
  }[];
}

@Injectable()
export class DonationService {
  constructor(private readonly tenantContext: TenantContextService) {}

  async listMine(range: DateRange = {}): Promise<DonationResponse[]> {
    const manager = this.tenantContext.getManager();
    // `InPersonDonation` y no `Donation`: las dos variantes comparten tabla, y
    // el repositorio de la subclase agrega el filtro por `kind`. Con la clase
    // base este historial listaría también las donaciones económicas.
    // La clave se omite cuando no hay rango: TypeORM rechaza un `undefined`
    // dentro del `where` en vez de ignorarlo.
    const createdAt = createdAtWithin(range);
    const donations = await manager.getRepository(InPersonDonation).find({
      where: {
        organizationId: this.orgId,
        ...(createdAt ? { createdAt } : {}),
      },
      order: { createdAt: 'DESC' },
    });
    if (donations.length === 0) {
      return [];
    }

    // Sin `relations`: ninguna entidad del proyecto declara relaciones TypeORM.
    const items = await manager.getRepository(DonationItem).find({
      where: {
        organizationId: this.orgId,
        donationId: In(donations.map((donation) => donation.id)),
      },
    });

    const itemsByDonation = new Map<string, DonationItem[]>();
    for (const item of items) {
      const list = itemsByDonation.get(item.donationId) ?? [];
      list.push(item);
      itemsByDonation.set(item.donationId, list);
    }

    return donations.map((donation) =>
      toResponse(donation, itemsByDonation.get(donation.id) ?? []),
    );
  }

  /**
   * La donación ya llegó: se registra y se acredita a las necesidades en la
   * misma transacción. El manager viene del query runner del request, así que
   * la transacción hereda el `SET ROLE` y `app.current_org` — RLS sigue activo.
   */
  async create(dto: CreateDonationDto): Promise<DonationResponse> {
    return this.tenantContext.getManager().transaction(async (trx) => {
      await this.assertCollectionPointExists(trx, dto.collectionPointId);
      await this.assertItemsAreValid(trx, dto);

      const donation = await trx.getRepository(InPersonDonation).save(
        trx.getRepository(InPersonDonation).create({
          organizationId: this.orgId,
          collectionPointId: dto.collectionPointId ?? null,
          donorName: dto.donorName?.trim() || null,
          donorContact: dto.donorContact?.trim() || null,
        }),
      );

      const items = await trx.getRepository(DonationItem).save(
        dto.items.map((item) =>
          trx.getRepository(DonationItem).create({
            organizationId: this.orgId,
            donationId: donation.id,
            supplyId: item.supplyId,
            needId: item.needId ?? null,
            quantity: item.quantity,
          }),
        ),
      );

      await this.applyCoverage(trx, items);

      return toResponse(donation, items);
    });
  }

  private async assertCollectionPointExists(
    trx: EntityManager,
    collectionPointId: string | null | undefined,
  ): Promise<void> {
    if (!collectionPointId) {
      return;
    }
    const point = await trx.getRepository(CollectionPoint).findOneBy({
      id: collectionPointId,
      organizationId: this.orgId,
    });
    if (!point) {
      throw new NotFoundException('El punto de recolección no existe.');
    }
  }

  /**
   * Valida insumos y necesidades de todos los ítems antes de escribir nada.
   * Cachea lo ya resuelto: varios ítems suelen apuntar al mismo insumo.
   */
  private async assertItemsAreValid(
    trx: EntityManager,
    dto: CreateDonationDto,
  ): Promise<void> {
    const supplies = new Map<string, Supply>();
    const needs = new Map<string, Need>();

    for (const item of dto.items) {
      if (!supplies.has(item.supplyId)) {
        const supply = await trx.getRepository(Supply).findOneBy({
          id: item.supplyId,
          organizationId: this.orgId,
        });
        if (!supply) {
          throw new NotFoundException('El insumo indicado no existe.');
        }
        supplies.set(supply.id, supply);
      }

      if (!item.needId) {
        continue;
      }

      let need = needs.get(item.needId);
      if (!need) {
        const found = await trx.getRepository(Need).findOneBy({
          id: item.needId,
          organizationId: this.orgId,
        });
        if (!found) {
          throw new NotFoundException('La necesidad indicada no existe.');
        }
        needs.set(found.id, found);
        need = found;
      }

      if (isNeedClosed(need)) {
        throw new ConflictException('La necesidad ya está cerrada.');
      }
      if (need.supplyId !== item.supplyId) {
        throw new BadRequestException(
          'El insumo del ítem no coincide con el de la necesidad.',
        );
      }
    }
  }

  /**
   * Acredita cada ítem a su necesidad. El incremento se calcula en SQL para que
   * dos cargas simultáneas no se pisen, y se topea en la cantidad requerida: la
   * cantidad real recibida ya quedó en `donation_items`, y `coveredQuantity` es
   * progreso, no inventario.
   */
  private async applyCoverage(
    trx: EntityManager,
    items: DonationItem[],
  ): Promise<void> {
    for (const item of items) {
      if (!item.needId) {
        continue;
      }
      await trx
        .createQueryBuilder()
        .update(Need)
        .set({
          coveredQuantity: () =>
            'LEAST("requiredQuantity", "coveredQuantity" + :quantity)',
          updatedAt: () => 'now()',
        })
        .where('id = :id AND "organizationId" = :organizationId', {
          id: item.needId,
          organizationId: this.orgId,
        })
        .setParameter('quantity', item.quantity)
        .execute();
    }
  }

  private get orgId(): string {
    return this.tenantContext.organizationId;
  }
}

function toResponse(
  donation: InPersonDonation,
  items: DonationItem[],
): DonationResponse {
  return {
    id: donation.id,
    collectionPointId: donation.collectionPointId,
    donorName: donation.donorName,
    donorContact: donation.donorContact,
    createdAt: donation.createdAt,
    items: items.map((item) => ({
      id: item.id,
      supplyId: item.supplyId,
      needId: item.needId,
      quantity: item.quantity,
    })),
  };
}
