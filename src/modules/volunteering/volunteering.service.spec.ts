/* eslint-disable @typescript-eslint/unbound-method -- jest.fn() mocks are safe to reference unbound */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { TenantContextService } from '../tenant/tenant-context.service';
import { CreateOpportunityDto } from './dto/create-opportunity.dto';
import {
  ApplicationStatus,
  VolunteerApplication,
} from './entities/volunteer-application.entity';
import {
  OpportunityStatus,
  VolunteerOpportunity,
} from './entities/volunteer-opportunity.entity';
import { VolunteeringService } from './volunteering.service';

function makeDto(
  overrides: Partial<CreateOpportunityDto> = {},
): CreateOpportunityDto {
  return {
    title: 'Merienda del sábado',
    description: 'Servimos la merienda a 80 chicos del barrio.',
    startsAt: '2026-09-12T17:00:00.000Z',
    location: 'Bv. Sarmiento 1450, Villa María',
    capacity: 4,
    ...overrides,
  };
}

function makeOpportunity(
  overrides: Partial<VolunteerOpportunity> = {},
): VolunteerOpportunity {
  return {
    id: 'opp-1',
    organizationId: 'org-1',
    title: 'Merienda del sábado',
    description: 'Servimos la merienda a 80 chicos del barrio.',
    startsAt: new Date('2026-09-12T17:00:00.000Z'),
    location: 'Bv. Sarmiento 1450, Villa María',
    capacity: 4,
    acceptedCount: 0,
    status: OpportunityStatus.OPEN,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeApplication(
  overrides: Partial<VolunteerApplication> = {},
): VolunteerApplication {
  return {
    id: 'app-1',
    organizationId: 'org-1',
    opportunityId: 'opp-1',
    userId: 'user-1',
    status: ApplicationStatus.PENDING,
    createdAt: new Date(),
    decidedAt: null,
    ...overrides,
  };
}

describe('VolunteeringService', () => {
  let service: VolunteeringService;
  let opportunities: jest.Mocked<Repository<VolunteerOpportunity>>;
  let applications: jest.Mocked<Repository<VolunteerApplication>>;

  beforeEach(() => {
    opportunities = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      findOneBy: jest.fn().mockResolvedValue(null),
      create: jest.fn((data) => data as VolunteerOpportunity),
      save: jest.fn((entity) =>
        Promise.resolve(entity as VolunteerOpportunity),
      ),
    } as unknown as jest.Mocked<Repository<VolunteerOpportunity>>;

    applications = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      findOneBy: jest.fn().mockResolvedValue(null),
      create: jest.fn((data) => data as VolunteerApplication),
      save: jest.fn((entity) =>
        Promise.resolve(entity as VolunteerApplication),
      ),
    } as unknown as jest.Mocked<Repository<VolunteerApplication>>;

    const manager = {
      getRepository: (entity: unknown) =>
        entity === VolunteerOpportunity ? opportunities : applications,
      // La transacción real hereda el SET ROLE del request; en el test alcanza
      // con ejecutar el callback con el mismo manager.
      transaction: (fn: (trx: unknown) => unknown) => fn(manager),
      query: jest.fn().mockResolvedValue([]),
    };

    const tenantContext = {
      organizationId: 'org-1',
      getManager: jest.fn().mockReturnValue(manager),
    } as unknown as jest.Mocked<TenantContextService>;

    service = new VolunteeringService(tenantContext);
  });

  describe('create', () => {
    it('crea la oportunidad abierta y sin postulaciones aceptadas', async () => {
      const created = await service.create(makeDto());

      expect(created.status).toBe(OpportunityStatus.OPEN);
      expect(created.acceptedCount).toBe(0);
      expect(created.organizationId).toBe('org-1');
      expect(opportunities.save).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('actualiza los datos de una oportunidad abierta', async () => {
      opportunities.findOneBy.mockResolvedValue(makeOpportunity());

      const updated = await service.update(
        'opp-1',
        makeDto({ title: 'Merienda del domingo', capacity: 6 }),
      );

      expect(updated.title).toBe('Merienda del domingo');
      expect(updated.capacity).toBe(6);
    });

    it('no deja bajar los cupos por debajo de los ya aceptados', async () => {
      opportunities.findOneBy.mockResolvedValue(
        makeOpportunity({ acceptedCount: 3 }),
      );

      await expect(
        service.update('opp-1', makeDto({ capacity: 2 })),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('no deja editar una oportunidad cancelada', async () => {
      opportunities.findOneBy.mockResolvedValue(
        makeOpportunity({ status: OpportunityStatus.CANCELLED }),
      );

      await expect(service.update('opp-1', makeDto())).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('falla si la oportunidad no existe', async () => {
      await expect(service.update('nope', makeDto())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('close / cancel', () => {
    it('cierra la oportunidad', async () => {
      opportunities.findOneBy.mockResolvedValue(makeOpportunity());

      await expect(service.close('opp-1')).resolves.toMatchObject({
        status: OpportunityStatus.CLOSED,
      });
    });

    it('cancela la oportunidad', async () => {
      opportunities.findOneBy.mockResolvedValue(makeOpportunity());

      await expect(service.cancel('opp-1')).resolves.toMatchObject({
        status: OpportunityStatus.CANCELLED,
      });
    });
  });

  describe('apply', () => {
    it('deja postularse a una oportunidad abierta', async () => {
      opportunities.findOneBy.mockResolvedValue(makeOpportunity());

      const application = await service.apply('opp-1', 'user-1');

      expect(application.status).toBe(ApplicationStatus.PENDING);
      expect(application.userId).toBe('user-1');
      expect(applications.save).toHaveBeenCalled();
    });

    it('rechaza una segunda postulación del mismo voluntario', async () => {
      opportunities.findOneBy.mockResolvedValue(makeOpportunity());
      applications.findOne.mockResolvedValue(makeApplication());

      await expect(service.apply('opp-1', 'user-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(applications.save).not.toHaveBeenCalled();
    });

    it('rechaza la postulación si el cupo ya está lleno', async () => {
      opportunities.findOneBy.mockResolvedValue(
        makeOpportunity({ capacity: 2, acceptedCount: 2 }),
      );

      await expect(service.apply('opp-1', 'user-2')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rechaza la postulación si la oportunidad está cancelada', async () => {
      opportunities.findOneBy.mockResolvedValue(
        makeOpportunity({ status: OpportunityStatus.CANCELLED }),
      );

      await expect(service.apply('opp-1', 'user-2')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('accept', () => {
    it('acepta la postulación y consume un cupo', async () => {
      applications.findOneBy.mockResolvedValue(makeApplication());
      opportunities.findOne.mockResolvedValue(makeOpportunity());

      const accepted = await service.accept('app-1');

      expect(accepted.status).toBe(ApplicationStatus.ACCEPTED);
      expect(accepted.decidedAt).toBeInstanceOf(Date);
      expect(opportunities.save).toHaveBeenCalledWith(
        expect.objectContaining({ acceptedCount: 1 }),
      );
    });

    it('rechaza aceptar cuando ya no quedan cupos', async () => {
      applications.findOneBy.mockResolvedValue(makeApplication());
      opportunities.findOne.mockResolvedValue(
        makeOpportunity({ capacity: 1, acceptedCount: 1 }),
      );

      await expect(service.accept('app-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(opportunities.save).not.toHaveBeenCalled();
    });

    it('rechaza decidir dos veces la misma postulación', async () => {
      applications.findOneBy.mockResolvedValue(
        makeApplication({ status: ApplicationStatus.ACCEPTED }),
      );

      await expect(service.accept('app-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('falla si la postulación no existe', async () => {
      await expect(service.accept('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('reject', () => {
    it('rechaza la postulación sin tocar el cupo', async () => {
      applications.findOneBy.mockResolvedValue(makeApplication());

      const rejected = await service.reject('app-1');

      expect(rejected.status).toBe(ApplicationStatus.REJECTED);
      expect(opportunities.save).not.toHaveBeenCalled();
    });

    it('rechaza decidir dos veces la misma postulación', async () => {
      applications.findOneBy.mockResolvedValue(
        makeApplication({ status: ApplicationStatus.REJECTED }),
      );

      await expect(service.reject('app-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('list', () => {
    it('marca el estado de la postulación propia y si sigue abierta', async () => {
      opportunities.find.mockResolvedValue([
        makeOpportunity(),
        makeOpportunity({
          id: 'opp-2',
          capacity: 1,
          acceptedCount: 1,
        }),
      ]);
      applications.find.mockResolvedValue([
        makeApplication({ status: ApplicationStatus.ACCEPTED }),
        makeApplication({ id: 'app-2', userId: 'otro' }),
      ]);

      const list = await service.list('user-1');

      expect(list[0]).toMatchObject({
        id: 'opp-1',
        isOpen: true,
        myApplicationStatus: ApplicationStatus.ACCEPTED,
        pendingCount: 1,
      });
      expect(list[1]).toMatchObject({
        id: 'opp-2',
        isOpen: false,
        myApplicationStatus: null,
        pendingCount: 0,
      });
    });
  });
});
