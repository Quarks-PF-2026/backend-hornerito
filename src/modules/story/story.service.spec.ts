import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { CloudinaryService } from '../media/cloudinary.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { Story, StoryMediaType } from './entities/story.entity';
import { MAX_LIVE_STORIES, StoryService } from './story.service';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const UUID = '44444444-4444-4444-8444-444444444444';
const MB = 1024 * 1024;
const DAY_MS = 86_400_000;

const folder = (orgId = ORG_ID) =>
  `hornerito/${process.env.NODE_ENV ?? 'development'}/${orgId}/stories`;
const PUBLIC_ID = `${folder()}/${UUID}`;

function resource(overrides: Record<string, unknown> = {}) {
  return {
    url: 'https://res.cloudinary.com/demo/historia.jpg',
    publicId: PUBLIC_ID,
    format: 'jpg',
    width: 1080,
    height: 1920,
    bytes: 2 * MB,
    ...overrides,
  };
}

/** SQL del `Raw` de vigencia, para distinguir vigentes de vencidas. */
const rawSql = (value: unknown) =>
  (value as FindOperator<unknown> & { getSql: (c: string) => string }).getSql(
    'col',
  );

describe('StoryService', () => {
  let service: StoryService;
  let repo: {
    find: jest.Mock;
    countBy: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    exists: jest.Mock;
  };
  let manager: {
    getRepository: jest.Mock;
    transaction: jest.Mock;
    query: jest.Mock;
  };
  let cloudinary: {
    signUpload: jest.Mock;
    getResource: jest.Mock;
    destroy: jest.Mock;
  };

  beforeEach(() => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      countBy: jest.fn().mockResolvedValue(0),
      create: jest.fn((value: Partial<Story>) => value),
      save: jest.fn((value: Partial<Story>) =>
        Promise.resolve({ ...value, id: 'story-1' }),
      ),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      exists: jest.fn().mockResolvedValue(false),
    };
    manager = {
      getRepository: jest.fn(() => repo),
      transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(manager)),
      query: jest.fn().mockResolvedValue([]),
    };
    cloudinary = {
      signUpload: jest.fn((publicId: string, formats: string[]) => ({
        cloudName: 'demo',
        params: { public_id: publicId, allowed_formats: formats.join(',') },
      })),
      getResource: jest.fn().mockResolvedValue(resource()),
      destroy: jest.fn().mockResolvedValue(undefined),
    };
    const tenantContext = {
      organizationId: ORG_ID,
      getManager: () => manager,
    } as unknown as TenantContextService;
    service = new StoryService(
      tenantContext,
      cloudinary as unknown as CloudinaryService,
    );
  });

  const create = (overrides: Record<string, unknown> = {}) =>
    service.create(
      {
        publicId: PUBLIC_ID,
        resourceType: StoryMediaType.IMAGE,
        ...overrides,
      },
      USER_ID,
    );

  describe('Dado que la organización publica una historia', () => {
    it('Entonces vence 7 días después y queda a nombre de la organización del token', async () => {
      const story = await create({ text: 'Hoy cocinamos guiso' });

      const [[saved]] = repo.save.mock.calls as [[Story]];
      expect(saved.organizationId).toBe(ORG_ID);
      expect(saved.createdByUserId).toBe(USER_ID);
      expect(saved.expiresAt.getTime() - saved.createdAt.getTime()).toBe(
        7 * DAY_MS,
      );
      expect(story).toMatchObject({
        id: 'story-1',
        mediaUrl: resource().url,
        mediaType: 'image',
        durationSec: null,
        text: 'Hoy cocinamos guiso',
        linkUrl: null,
      });
      expect(cloudinary.destroy).not.toHaveBeenCalled();
    });

    it('Entonces un video guarda la duración que informa Cloudinary', async () => {
      cloudinary.getResource.mockResolvedValue(
        resource({ format: 'mp4', bytes: 15 * MB, duration: 25 }),
      );
      const story = await create({ resourceType: StoryMediaType.VIDEO });
      expect(story.durationSec).toBe(25);
      expect(cloudinary.getResource).toHaveBeenCalledWith(PUBLIC_ID, 'video');
    });

    it('Entonces el alta recuenta el cupo dentro de una transacción con lock por organización', async () => {
      await create();
      expect(manager.transaction).toHaveBeenCalled();
      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining('pg_advisory_xact_lock'),
        [`stories:${ORG_ID}`],
      );
      expect(repo.countBy).toHaveBeenCalledTimes(2);
    });
  });

  describe('Dado un archivo que no cumple los requisitos', () => {
    it.each([
      ['una imagen GIF', 'image', { format: 'gif' }, 'formato'],
      ['un video MOV', 'video', { format: 'mov', duration: 10 }, 'formato'],
      [
        'una imagen de 12 MB',
        'image',
        { format: 'png', bytes: 12 * MB },
        '8 MB',
      ],
      [
        'un video de 25 MB',
        'video',
        { format: 'webm', bytes: 25 * MB, duration: 20 },
        '20 MB',
      ],
      [
        'un video de 45 segundos',
        'video',
        { format: 'mp4', duration: 45 },
        '30 segundos',
      ],
      [
        'un video sin duración informada',
        'video',
        { format: 'mp4' },
        '30 segundos',
      ],
    ])(
      'Cuando se publica %s, entonces se rechaza y se borra de Cloudinary',
      async (_caso, type, overrides, motivo) => {
        cloudinary.getResource.mockResolvedValue(resource(overrides));

        const attempt = create({ resourceType: type });

        await expect(attempt).rejects.toThrow(BadRequestException);
        await expect(attempt).rejects.toThrow(motivo);
        expect(cloudinary.destroy).toHaveBeenCalledWith(PUBLIC_ID, type);
        expect(repo.save).not.toHaveBeenCalled();
      },
    );

    it('Cuando el archivo no existe en Cloudinary, entonces 400 sin borrar nada', async () => {
      cloudinary.getResource.mockResolvedValue(null);
      await expect(create()).rejects.toThrow(BadRequestException);
      expect(cloudinary.destroy).not.toHaveBeenCalled();
    });

    it('Cuando el archivo es de la carpeta de otra organización, entonces se rechaza sin consultarlo ni borrarlo', async () => {
      await expect(
        create({ publicId: `${folder(OTHER_ORG_ID)}/${UUID}` }),
      ).rejects.toThrow(BadRequestException);
      expect(cloudinary.getResource).not.toHaveBeenCalled();
      expect(cloudinary.destroy).not.toHaveBeenCalled();
    });
  });

  describe('Dado un doble submit con un archivo que ya usa otra historia', () => {
    it('Cuando se reenvía el alta, entonces 400 sin consultar ni borrar el archivo', async () => {
      repo.exists.mockResolvedValue(true);

      await expect(create()).rejects.toThrow(
        'Esa media ya se usó en otra historia.',
      );
      expect(repo.exists).toHaveBeenCalledWith({
        where: { organizationId: ORG_ID, mediaPublicId: PUBLIC_ID },
        withDeleted: true,
      });
      expect(cloudinary.getResource).not.toHaveBeenCalled();
      expect(cloudinary.destroy).not.toHaveBeenCalled();
    });

    it('Cuando la otra alta guardó mientras esta validaba, entonces el rechazo en la transacción no borra su archivo', async () => {
      // Libre al validar; ya referenciado dentro de la transacción y al borrar.
      repo.exists.mockResolvedValueOnce(false).mockResolvedValue(true);

      await expect(create()).rejects.toThrow(
        'Esa media ya se usó en otra historia.',
      );
      expect(repo.save).not.toHaveBeenCalled();
      expect(cloudinary.destroy).not.toHaveBeenCalled();
    });

    it('Cuando el alta falla por cupo y el archivo ya quedó referenciado, entonces no se borra', async () => {
      repo.countBy
        .mockResolvedValueOnce(MAX_LIVE_STORIES - 1)
        .mockResolvedValueOnce(MAX_LIVE_STORIES);
      repo.exists
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValue(true);

      await expect(create()).rejects.toThrow('20');
      expect(cloudinary.destroy).not.toHaveBeenCalled();
    });
  });

  describe('Dado que el cliente declara un tipo distinto al del archivo subido', () => {
    it('Cuando el archivo existe con el otro tipo, entonces se borra con ese tipo y 400', async () => {
      cloudinary.getResource
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(resource({ format: 'mp4', duration: 10 }));

      await expect(create()).rejects.toThrow('El tipo del archivo no coincide');
      expect(cloudinary.destroy).toHaveBeenCalledWith(PUBLIC_ID, 'video');
    });
  });

  describe(`Dado que la organización ya tiene ${MAX_LIVE_STORIES} historias vigentes`, () => {
    beforeEach(() => repo.countBy.mockResolvedValue(MAX_LIVE_STORIES));

    it('Cuando pide firmar otra subida, entonces se rechaza mencionando el tope', async () => {
      await expect(service.sign(StoryMediaType.IMAGE)).rejects.toThrow('20');
      expect(cloudinary.signUpload).not.toHaveBeenCalled();
    });

    it('Cuando publica otra, entonces se rechaza sin leer el archivo', async () => {
      await expect(create()).rejects.toThrow('20');
      expect(cloudinary.getResource).not.toHaveBeenCalled();
    });

    it('Cuando el cupo se llenó entre la firma y el alta, entonces se rechaza y se borra el archivo', async () => {
      repo.countBy
        .mockResolvedValueOnce(MAX_LIVE_STORIES - 1)
        .mockResolvedValueOnce(MAX_LIVE_STORIES);
      await expect(create()).rejects.toThrow('20');
      expect(cloudinary.destroy).toHaveBeenCalledWith(PUBLIC_ID, 'image');
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('Entonces solo cuenta vigentes de su organización', async () => {
      await expect(create()).rejects.toThrow();
      const [[where]] = repo.countBy.mock.calls as [[Record<string, unknown>]];
      expect(where.organizationId).toBe(ORG_ID);
      expect(rawSql(where.expiresAt)).toBe('col > now()');
    });
  });

  describe('Cuando se pide la firma', () => {
    it('Entonces el publicId cae en la carpeta de la organización y los formatos son los del tipo', async () => {
      const signature = await service.sign(StoryMediaType.VIDEO);
      expect(signature.publicId).toMatch(
        new RegExp(`^${folder()}/[0-9a-f-]{36}$`),
      );
      expect(cloudinary.signUpload).toHaveBeenCalledWith(signature.publicId, [
        'mp4',
        'webm',
      ]);
    });
  });

  describe('Cuando se lista el panel', () => {
    it('Entonces separa vigentes (más nueva primero) de vencidas (vencimiento más reciente primero), solo de su organización', async () => {
      await service.list();
      const [activeQuery, expiredQuery] = repo.find.mock.calls.map(
        ([options]) =>
          options as {
            where: Record<string, unknown>;
            order: Record<string, string>;
          },
      );
      expect(activeQuery.where.organizationId).toBe(ORG_ID);
      expect(rawSql(activeQuery.where.expiresAt)).toBe('col > now()');
      expect(activeQuery.order).toEqual({ createdAt: 'DESC' });
      expect(expiredQuery.where.organizationId).toBe(ORG_ID);
      expect(rawSql(expiredQuery.where.expiresAt)).toBe('col <= now()');
      expect(expiredQuery.order).toEqual({ expiresAt: 'DESC' });
    });
  });

  describe('Cuando se elimina una historia', () => {
    it('Entonces es borrado lógico filtrado por su organización', async () => {
      await service.remove(UUID);
      const [where, values] = repo.update.mock.calls[0] as [
        Record<string, unknown>,
        Record<string, unknown>,
      ];
      expect(where).toMatchObject({ id: UUID, organizationId: ORG_ID });
      expect(where.deletedAt).toBeDefined();
      expect(typeof values.deletedAt).toBe('function');
    });

    it('Entonces una historia de otra organización (o ya eliminada) da 404', async () => {
      repo.update.mockResolvedValue({ affected: 0 });
      await expect(service.remove(UUID)).rejects.toThrow(NotFoundException);
    });
  });
});
