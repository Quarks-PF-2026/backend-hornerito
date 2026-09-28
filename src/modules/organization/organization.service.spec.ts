import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { MailService } from '../mail/mail.service';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import {
  Organization,
  OrganizationStatus,
} from './entities/organization.entity';
import {
  OrganizationMembership,
  OrganizationMembershipRole,
} from './entities/organization-membership.entity';
import { OrganizationService } from './organization.service';

const USER_ID = 'user-1';
const ORG_ID = 'org-1';

/** Perfil mínimo que el DTO exige; la historia va sobre lo que se le suma. */
const PERFIL = {
  name: 'Comedor Manos del Barrio',
  description: 'Brindamos almuerzo y merienda.',
  address: 'Bv. Sarmiento 1450',
  contact: '353 412-7788',
};

function makeOrganization(overrides: Partial<Organization> = {}): Organization {
  return {
    id: ORG_ID,
    ownerId: USER_ID,
    ...PERFIL,
    status: OrganizationStatus.VALIDATED,
    rejectReason: null,
    seeksVolunteers: false,
    paymentAlias: null,
    paymentHolder: null,
    paymentCuit: null,
    paymentBank: null,
    locality: null,
    province: null,
    country: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * QK-112: la ubicación se guarda como una unidad. Estos tests fijan esa
 * decisión, que es lo que distingue el trío de tres campos opcionales sueltos.
 */
describe('OrganizationService — ubicación (QK-112)', () => {
  let organizationRepository: {
    findById: jest.Mock;
    findByIds: jest.Mock;
    findPending: jest.Mock;
    transitionFromPending: jest.Mock;
    save: jest.Mock;
    deleteById: jest.Mock;
  };
  let service: OrganizationService;

  /** Guarda el perfil del dueño y devuelve la organización persistida. */
  async function guardar(
    dto: Partial<UpdateOrganizationDto>,
    existente: Organization,
  ): Promise<Organization> {
    organizationRepository.findById.mockResolvedValue(existente);
    return service.upsertMine(USER_ID, {
      ...PERFIL,
      ...dto,
    });
  }

  beforeEach(() => {
    organizationRepository = {
      findById: jest.fn(),
      findByIds: jest.fn().mockResolvedValue([]),
      findPending: jest.fn().mockResolvedValue([]),
      transitionFromPending: jest.fn(),
      save: jest.fn((org: Organization) => Promise.resolve(org)),
      deleteById: jest.fn(),
    };

    const membership: OrganizationMembership = {
      id: 'membership-1',
      userId: USER_ID,
      organizationId: ORG_ID,
      role: OrganizationMembershipRole.OWNER,
      active: true,
      createdAt: new Date(),
    };

    service = new OrganizationService(
      organizationRepository,
      { findByUserId: jest.fn().mockResolvedValue([membership]) } as never,
      { findById: jest.fn(), findByIds: jest.fn() } as never,
      {} as MailService,
      { get: jest.fn() } as unknown as ConfigService,
      {} as DataSource,
    );
  });

  it('guarda localidad, provincia y país juntas', async () => {
    const guardada = await guardar(
      { locality: 'Villa María', province: 'Córdoba', country: 'Argentina' },
      makeOrganization(),
    );

    expect(guardada).toMatchObject({
      locality: 'Villa María',
      province: 'Córdoba',
      country: 'Argentina',
    });
  });

  it('no deja restos de la localidad anterior al cambiarla', async () => {
    const guardada = await guardar(
      { locality: 'Río Cuarto', province: 'Córdoba', country: 'Argentina' },
      makeOrganization({
        locality: 'Bahía Blanca',
        province: 'Buenos Aires',
        country: 'Argentina',
      }),
    );

    expect(guardada.locality).toBe('Río Cuarto');
    expect(guardada.province).toBe('Córdoba');
  });

  it('nunca mezcla la localidad nueva con la provincia vieja', async () => {
    // Una sugerencia siempre trae las tres; si llegara solo la localidad, la
    // provincia guardada queda inválida para ella y se limpia.
    const guardada = await guardar(
      { locality: 'Río Cuarto' },
      makeOrganization({ locality: 'Bahía Blanca', province: 'Buenos Aires' }),
    );

    expect(guardada.province).toBeNull();
    expect(guardada.country).toBeNull();
  });

  it('deja la ubicación intacta cuando el perfil se reenvía sin ella', async () => {
    // Es lo que hace el interruptor de "buscamos voluntarios": manda el perfil
    // entero sin tocar la ubicación, y no puede borrarla de costado.
    const guardada = await guardar(
      { seeksVolunteers: true },
      makeOrganization({ locality: 'Villa María', province: 'Córdoba' }),
    );

    expect(guardada.locality).toBe('Villa María');
    expect(guardada.province).toBe('Córdoba');
  });

  it('guarda el perfil sin localidad cuando llega vacía', async () => {
    const guardada = await guardar({ locality: '' }, makeOrganization());

    expect(guardada.locality).toBeNull();
    expect(guardada.address).toBe(PERFIL.address);
  });
});
