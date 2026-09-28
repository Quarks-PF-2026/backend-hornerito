/* eslint-disable @typescript-eslint/unbound-method -- jest.fn() mocks are safe to reference unbound */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Repository } from 'typeorm';
import { TenantContextService } from '../tenant/tenant-context.service';
import { CreateEventDto } from './dto/create-event.dto';
import { EventAttendance } from './entities/event-attendance.entity';
import { EventKind, OrgEvent } from './entities/event.entity';
import { EventService, isOccurrence, occurrenceDates } from './event.service';

const TODAY = '2026-09-27';

function makeEvent(overrides: Partial<OrgEvent> = {}): OrgEvent {
  return {
    id: 'event-1',
    organizationId: 'org-1',
    name: 'Merienda diaria',
    kind: EventKind.PERIODIC,
    startDate: '2026-09-20',
    active: true,
    endedOn: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('isOccurrence / occurrenceDates (funciones puras)', () => {
  describe('evento periódico', () => {
    const event = makeEvent({ startDate: '2026-09-10' });

    it('una fecha anterior al inicio no es ocurrencia', () => {
      expect(isOccurrence(event, '2026-09-09', TODAY)).toBe(false);
    });

    it('una fecha dentro del rango es ocurrencia', () => {
      expect(isOccurrence(event, '2026-09-15', TODAY)).toBe(true);
    });

    it('una fecha posterior a la baja (endedOn) no es ocurrencia', () => {
      const dado = makeEvent({
        startDate: '2026-09-10',
        endedOn: '2026-09-20',
      });
      expect(isOccurrence(dado, '2026-09-21', TODAY)).toBe(false);
      expect(isOccurrence(dado, '2026-09-20', TODAY)).toBe(true);
    });

    it('una fecha futura (posterior a hoy) no es ocurrencia', () => {
      expect(isOccurrence(event, '2026-09-28', TODAY)).toBe(false);
    });

    it('occurrenceDates arma el rango día a día acotado a hoy y al from/to pedido', () => {
      expect(occurrenceDates(event, '2026-09-08', TODAY, TODAY)).toEqual([
        '2026-09-10',
        '2026-09-11',
        '2026-09-12',
        '2026-09-13',
        '2026-09-14',
        '2026-09-15',
        '2026-09-16',
        '2026-09-17',
        '2026-09-18',
        '2026-09-19',
        '2026-09-20',
        '2026-09-21',
        '2026-09-22',
        '2026-09-23',
        '2026-09-24',
        '2026-09-25',
        '2026-09-26',
        '2026-09-27',
      ]);
    });
  });

  describe('evento extraordinario', () => {
    const event = makeEvent({
      kind: EventKind.ONE_OFF,
      startDate: '2026-09-15',
    });

    it('su propia fecha es ocurrencia', () => {
      expect(isOccurrence(event, '2026-09-15', TODAY)).toBe(true);
    });

    it('cualquier otra fecha no es ocurrencia', () => {
      expect(isOccurrence(event, '2026-09-16', TODAY)).toBe(false);
    });

    it('occurrenceDates devuelve una única fecha si cae en el rango pedido', () => {
      expect(occurrenceDates(event, '2026-09-01', TODAY, TODAY)).toEqual([
        '2026-09-15',
      ]);
      expect(occurrenceDates(event, '2026-09-16', TODAY, TODAY)).toEqual([]);
    });
  });
});

describe('EventService', () => {
  let service: EventService;
  let eventRepo: jest.Mocked<Repository<OrgEvent>>;
  let attendanceRepo: jest.Mocked<Repository<EventAttendance>>;
  let tenantContext: jest.Mocked<TenantContextService>;

  beforeEach(() => {
    eventRepo = {
      find: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn((data) => data as OrgEvent),
      save: jest.fn((entity) => Promise.resolve(entity as OrgEvent)),
    } as unknown as jest.Mocked<Repository<OrgEvent>>;
    attendanceRepo = {
      count: jest.fn(),
      find: jest.fn(),
      upsert: jest.fn(),
    } as unknown as jest.Mocked<Repository<EventAttendance>>;
    tenantContext = {
      organizationId: 'org-1',
      getManager: jest.fn().mockReturnValue({
        getRepository: (entity: unknown) =>
          entity === EventAttendance ? attendanceRepo : eventRepo,
      }),
    } as unknown as jest.Mocked<TenantContextService>;
    service = new EventService(tenantContext);
  });

  describe('update — Dado un evento con asistencia registrada', () => {
    it('Cuando se intenta cambiar el kind, Entonces rechaza con 409', async () => {
      eventRepo.findOneBy.mockResolvedValue(makeEvent());
      attendanceRepo.count.mockResolvedValue(1);

      await expect(
        service.update('event-1', { kind: EventKind.ONE_OFF }),
      ).rejects.toThrow(ConflictException);
      expect(eventRepo.save).not.toHaveBeenCalled();
    });

    it('Cuando se intenta cambiar el startDate, Entonces rechaza con 409', async () => {
      eventRepo.findOneBy.mockResolvedValue(makeEvent());
      attendanceRepo.count.mockResolvedValue(1);

      await expect(
        service.update('event-1', { startDate: '2026-09-01' }),
      ).rejects.toThrow(ConflictException);
    });

    it('Cuando se le cambia solo el nombre, Entonces se guarda sin restricciones', async () => {
      eventRepo.findOneBy.mockResolvedValue(makeEvent());
      attendanceRepo.count.mockResolvedValue(1);

      const result = await service.update('event-1', {
        name: 'Merienda de la tarde',
      });

      expect(result.name).toBe('Merienda de la tarde');
      expect(eventRepo.save).toHaveBeenCalled();
    });

    it('Cuando el startDate enviado es igual al actual, Entonces no cuenta como cambio', async () => {
      const event = makeEvent();
      eventRepo.findOneBy.mockResolvedValue(event);
      attendanceRepo.count.mockResolvedValue(1);

      await expect(
        service.update('event-1', { startDate: event.startDate }),
      ).resolves.toMatchObject({ startDate: event.startDate });
    });
  });

  describe('deactivate', () => {
    it('es idempotente: un evento ya inactivo no mueve su endedOn', async () => {
      const inactivo = makeEvent({ active: false, endedOn: '2026-09-01' });
      eventRepo.findOneBy.mockResolvedValue(inactivo);

      const result = await service.deactivate('event-1');

      expect(result.endedOn).toBe('2026-09-01');
      expect(eventRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('setAttendance — Dado un :date con formato o calendario inválido', () => {
    it('Cuando la fecha no existe en el calendario (30 de febrero), Entonces rechaza con 400 en vez de romper contra Postgres', async () => {
      await expect(
        service.setAttendance('event-1', '2026-02-30', { count: 1 }),
      ).rejects.toThrow(BadRequestException);
      expect(eventRepo.findOneBy).not.toHaveBeenCalled();
    });

    it('Cuando la fecha trae hora (datetime ISO), Entonces rechaza con 400', async () => {
      await expect(
        service.setAttendance('event-1', '2026-09-27T03:00:00Z', { count: 1 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('Cuando el mes no existe (13), Entonces rechaza con 400', async () => {
      await expect(
        service.setAttendance('event-1', '2026-13-01', { count: 1 }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});

describe('CreateEventDto — validación de startDate', () => {
  async function errorsFor(startDate: unknown) {
    const dto = plainToInstance(CreateEventDto, {
      name: 'Merienda diaria',
      kind: EventKind.PERIODIC,
      startDate,
    });
    return validate(dto);
  }

  it('acepta una fecha AAAA-MM-DD válida', async () => {
    expect(await errorsFor('2026-09-27')).toHaveLength(0);
  });

  it('rechaza un datetime ISO con hora', async () => {
    const errors = await errorsFor('2026-09-27T03:00:00Z');
    expect(errors.some((e) => e.property === 'startDate')).toBe(true);
  });

  it('rechaza una fecha imposible (30 de febrero)', async () => {
    const errors = await errorsFor('2026-02-30');
    expect(errors.some((e) => e.property === 'startDate')).toBe(true);
  });

  it('rechaza el formato básico sin guiones', async () => {
    const errors = await errorsFor('20260927');
    expect(errors.some((e) => e.property === 'startDate')).toBe(true);
  });
});
