/* eslint-disable @typescript-eslint/unbound-method -- jest.fn() mocks are safe to reference unbound */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Repository } from 'typeorm';
import { TenantContextService } from '../tenant/tenant-context.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { EventAttendance } from './entities/event-attendance.entity';
import { EventKind, OrgEvent } from './entities/event.entity';
import {
  EventService,
  isOccurrence,
  occurrenceDates,
  weekdayOf,
} from './event.service';

const TODAY = '2026-09-27';

function makeEvent(overrides: Partial<OrgEvent> = {}): OrgEvent {
  return {
    id: 'event-1',
    organizationId: 'org-1',
    name: 'Merienda diaria',
    kind: EventKind.PERIODIC,
    startDate: '2026-09-20',
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    startTime: '17:00',
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

  describe('evento periódico en algunos días de la semana', () => {
    // 2026-09-14 es lunes.
    const event = makeEvent({ startDate: '2026-09-14', weekdays: [1, 3, 5] });

    it('weekdayOf numera 0 = domingo … 6 = sábado', () => {
      expect(weekdayOf('2026-09-13')).toBe(0);
      expect(weekdayOf('2026-09-14')).toBe(1);
      expect(weekdayOf('2026-09-19')).toBe(6);
    });

    it('Dado lunes, miércoles y viernes, Entonces occurrenceDates saltea los demás días', () => {
      expect(occurrenceDates(event, '2026-09-14', '2026-09-20', TODAY)).toEqual(
        ['2026-09-14', '2026-09-16', '2026-09-18'],
      );
    });

    it('Dado lunes, miércoles y viernes, Entonces un martes dentro del rango no es ocurrencia', () => {
      expect(isOccurrence(event, '2026-09-15', TODAY)).toBe(false);
      expect(isOccurrence(event, '2026-09-16', TODAY)).toBe(true);
    });
  });

  describe('evento extraordinario', () => {
    const event = makeEvent({
      kind: EventKind.ONE_OFF,
      weekdays: null,
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

  describe('update — Dado un evento con asistencia registrada (días y hora)', () => {
    it('Cuando se intenta cambiar los días de la semana, Entonces rechaza con 409', async () => {
      eventRepo.findOneBy.mockResolvedValue(makeEvent());
      attendanceRepo.count.mockResolvedValue(1);

      await expect(
        service.update('event-1', { weekdays: [1, 3, 5] }),
      ).rejects.toThrow(ConflictException);
    });

    it('Cuando se mandan los mismos días en otro orden, Entonces no cuenta como cambio', async () => {
      eventRepo.findOneBy.mockResolvedValue(makeEvent({ weekdays: [1, 3] }));
      attendanceRepo.count.mockResolvedValue(1);

      await expect(
        service.update('event-1', { weekdays: [3, 1] }),
      ).resolves.toMatchObject({ weekdays: [1, 3] });
    });

    it('Cuando se le cambia la hora de comienzo, Entonces se guarda', async () => {
      eventRepo.findOneBy.mockResolvedValue(makeEvent());
      attendanceRepo.count.mockResolvedValue(1);

      await expect(
        service.update('event-1', { startTime: '18:00' }),
      ).resolves.toMatchObject({ startTime: '18:00' });
    });
  });

  describe('update — Dado un evento sin asistencia', () => {
    it('Cuando pasa a extraordinario, Entonces sus días quedan en null', async () => {
      eventRepo.findOneBy.mockResolvedValue(makeEvent());
      attendanceRepo.count.mockResolvedValue(0);

      await expect(
        service.update('event-1', { kind: EventKind.ONE_OFF }),
      ).resolves.toMatchObject({ kind: EventKind.ONE_OFF, weekdays: null });
    });

    it('Cuando un extraordinario pasa a periódico sin días, Entonces rechaza con 400', async () => {
      eventRepo.findOneBy.mockResolvedValue(
        makeEvent({ kind: EventKind.ONE_OFF, weekdays: null }),
      );
      attendanceRepo.count.mockResolvedValue(0);

      await expect(
        service.update('event-1', { kind: EventKind.PERIODIC }),
      ).rejects.toThrow(BadRequestException);
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
      startTime: '17:00',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
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

describe('CreateEventDto — validación de weekdays y startTime', () => {
  async function errorsFor(overrides: Record<string, unknown>) {
    const dto = plainToInstance(CreateEventDto, {
      name: 'Apoyo escolar',
      kind: EventKind.PERIODIC,
      startDate: '2026-09-27',
      startTime: '17:30',
      weekdays: [1, 3, 5],
      ...overrides,
    });
    return (await validate(dto)).map((e) => e.property);
  }

  it('acepta un periódico con días válidos y hora HH:MM', async () => {
    expect(await errorsFor({})).toEqual([]);
  });

  it.each([[[]], [[1, 1]], [[7]], [[-1]], [[1.5]], [undefined]])(
    'rechaza weekdays = %j en un periódico',
    async (weekdays) => {
      expect(await errorsFor({ weekdays })).toContain('weekdays');
    },
  );

  it('no exige weekdays en un extraordinario', async () => {
    expect(
      await errorsFor({ kind: EventKind.ONE_OFF, weekdays: undefined }),
    ).toEqual([]);
  });

  it.each(['24:00', '7:30', '17:30:00', '', undefined])(
    'rechaza startTime = %j',
    async (startTime) => {
      expect(await errorsFor({ startTime })).toContain('startTime');
    },
  );
});

describe('UpdateEventDto — campos ausentes vs. null', () => {
  async function errorsFor(body: Record<string, unknown>) {
    const dto = plainToInstance(UpdateEventDto, body);
    return (await validate(dto)).map((e) => e.property);
  }

  it('un body vacío (todos los campos ausentes) pasa la validación', async () => {
    expect(await errorsFor({})).toEqual([]);
  });

  it.each(['weekdays', 'startTime', 'name', 'kind', 'startDate'])(
    'rechaza %s en null (400, no 500)',
    async (field) => {
      expect(await errorsFor({ [field]: null })).toContain(field);
    },
  );
});
