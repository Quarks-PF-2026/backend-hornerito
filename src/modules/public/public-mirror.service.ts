import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from '../organization/entities/organization.entity';
import { Need } from '../need/entities/need.entity';
import { Supply } from '../supply/entities/supply.entity';
import { PublicNeed } from './entities/public-need.entity';

/** Misma regla que `NeedService`: una necesidad cerrada no se muestra. */
export function isNeedClosed(need: Need): boolean {
  return need.closedManually || need.coveredQuantity >= need.requiredQuantity;
}

/**
 * Mantiene el espejo público al día desde los writes del tenant.
 *
 * ponytail: sincronía eventual y best-effort — si el espejo falla, el write
 * principal igual pasa y queda un warning. `npm run mirror:rebuild` reconstruye
 * todo desde los tenants, que son la fuente de verdad.
 */
@Injectable()
export class PublicMirrorService {
  private readonly logger = new Logger(PublicMirrorService.name);

  constructor(
    @InjectRepository(PublicNeed)
    private readonly needs: Repository<PublicNeed>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
  ) {}

  async upsertNeed(
    organizationId: string,
    need: Need,
    supply: Supply,
  ): Promise<void> {
    await this.safely('upsertNeed', () =>
      this.needs.save({
        id: need.id,
        organizationId,
        supplyId: supply.id,
        supplyName: supply.name,
        supplyCategory: supply.category,
        supplyUnit: supply.unit,
        requiredQuantity: need.requiredQuantity,
        coveredQuantity: need.coveredQuantity,
        deadline: need.deadline,
        closed: isNeedClosed(need),
      }),
    );
  }

  /** Al renombrar o recategorizar un insumo, sus necesidades espejadas quedan viejas. */
  async syncSupply(organizationId: string, supply: Supply): Promise<void> {
    await this.safely('syncSupply', () =>
      this.needs.update(
        { organizationId, supplyId: supply.id },
        {
          supplyName: supply.name,
          supplyCategory: supply.category,
          supplyUnit: supply.unit,
        },
      ),
    );
  }

  async removeNeedsByOrg(organizationId: string): Promise<void> {
    await this.safely('removeNeedsByOrg', () =>
      this.needs.delete({ organizationId }),
    );
  }

  async setOrganizationImage(
    organizationId: string,
    purpose: string,
    url: string | null,
  ): Promise<void> {
    const column = purpose === 'logo' ? 'logoUrl' : purpose === 'cover' ? 'coverUrl' : null;
    if (!column) {
      return;
    }
    await this.safely('setOrganizationImage', () =>
      this.organizations.update({ id: organizationId }, { [column]: url }),
    );
  }

  private async safely(action: string, run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.logger.warn(
        `No se pudo actualizar el directorio público (${action}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
