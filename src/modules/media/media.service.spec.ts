import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { OrganizationMembershipRole } from '../organization/entities/organization-membership.entity';
import { TenantContextService } from '../tenant/tenant-context.service';
import { CloudinaryService } from './cloudinary.service';
import { Media } from './entities/media.entity';
import { MediaActor, MediaService } from './media.service';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const POST_ID = '44444444-4444-4444-8444-444444444444';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16),
]);
const NOT_AN_IMAGE = Buffer.from('%PDF-1.4 esto no es una imagen', 'ascii');

function actor(
  role = OrganizationMembershipRole.OWNER,
  orgId = ORG_ID,
): MediaActor {
  return { userId: USER_ID, orgId, role };
}

function file(buffer: Buffer, size = buffer.length) {
  return { buffer, size };
}

describe('MediaService', () => {
  let service: MediaService;
  let repo: {
    find: jest.Mock;
    findOneBy: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    findBy?: jest.Mock;
    existsBy: jest.Mock;
    countBy: jest.Mock;
  };
  let cloudinary: {
    upload: jest.Mock;
    destroy: jest.Mock;
    signUpload: jest.Mock;
    getResource: jest.Mock;
  };

  beforeEach(() => {
    repo = {
      find: jest.fn(),
      findOneBy: jest.fn().mockResolvedValue(null),
      create: jest.fn((value: Partial<Media>) => value as Media),
      save: jest.fn((value: Media) =>
        Promise.resolve({ ...value, id: value.id ?? 'media-1' }),
      ),
      delete: jest.fn(),
      existsBy: jest.fn().mockResolvedValue(true),
      countBy: jest.fn().mockResolvedValue(0),
    };
    cloudinary = {
      upload: jest.fn().mockResolvedValue({
        url: 'https://res.cloudinary.com/demo/logo-nuevo.png',
        publicId: 'hornerito/test/logo-nuevo',
        format: 'png',
        width: 512,
        height: 512,
        bytes: 1234,
      }),
      destroy: jest.fn().mockResolvedValue(undefined),
      signUpload: jest.fn((publicId: string) => ({
        cloudName: 'demo',
        params: { public_id: publicId },
      })),
      getResource: jest.fn(),
    };

    const tenantContext = {
      organizationId: ORG_ID,
      getManager: jest.fn().mockReturnValue({ getRepository: () => repo }),
    } as unknown as TenantContextService;

    service = new MediaService(
      tenantContext,
      cloudinary as unknown as CloudinaryService,
    );
  });

  it('rechaza un ownerType que no está en el registro', async () => {
    await expect(
      service.uploadFor('factura', ORG_ID, 'logo', file(PNG), actor()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(cloudinary.upload).not.toHaveBeenCalled();
  });

  it('rechaza un purpose que el owner no declara', async () => {
    await expect(
      service.uploadFor('organization', ORG_ID, 'banner', file(PNG), actor()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza un archivo que no es imagen aunque diga que lo es', async () => {
    await expect(
      service.uploadFor(
        'organization',
        ORG_ID,
        'logo',
        file(NOT_AN_IMAGE),
        actor(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(cloudinary.upload).not.toHaveBeenCalled();
  });

  it('rechaza una imagen que supera el máximo del purpose', async () => {
    await expect(
      service.uploadFor(
        'organization',
        ORG_ID,
        'logo',
        file(PNG, 6_000_000),
        actor(),
      ),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('no deja cargar imágenes en otra organización', async () => {
    await expect(
      service.uploadFor(
        'organization',
        OTHER_ORG_ID,
        'logo',
        file(PNG),
        actor(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(cloudinary.upload).not.toHaveBeenCalled();
  });

  it('no deja subir a un rol sin permiso sobre la organización', async () => {
    await expect(
      service.uploadFor(
        'organization',
        ORG_ID,
        'logo',
        file(PNG),
        actor(OrganizationMembershipRole.VOLUNTEER),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('sube a una carpeta propia de la organización y guarda la fila', async () => {
    const saved = await service.uploadFor(
      'organization',
      ORG_ID,
      'logo',
      file(PNG),
      actor(),
    );

    expect(cloudinary.upload).toHaveBeenCalledWith(
      PNG,
      expect.objectContaining({
        folder: expect.stringContaining(
          `${ORG_ID}/organization/${ORG_ID}`,
        ) as string,
      }),
    );
    expect(saved.url).toBe('https://res.cloudinary.com/demo/logo-nuevo.png');
    expect(saved.organizationId).toBe(ORG_ID);
    expect(saved.createdBy).toBe(USER_ID);
    expect(cloudinary.destroy).not.toHaveBeenCalled();
  });

  it('borra la imagen anterior de Cloudinary al reemplazar el slot', async () => {
    repo.findOneBy.mockResolvedValue({
      id: 'media-1',
      publicId: 'hornerito/test/logo-viejo',
    });

    await service.uploadFor('organization', ORG_ID, 'logo', file(PNG), actor());

    expect(cloudinary.destroy).toHaveBeenCalledWith(
      'hornerito/test/logo-viejo',
      'image',
    );
  });

  it('si falla el borrado del anterior, la subida igual queda guardada', async () => {
    repo.findOneBy.mockResolvedValue({
      id: 'media-1',
      publicId: 'hornerito/test/logo-viejo',
    });
    cloudinary.destroy.mockRejectedValue(new Error('cloudinary caído'));

    const saved = await service.uploadFor(
      'organization',
      ORG_ID,
      'logo',
      file(PNG),
      actor(),
    );

    expect(saved.publicId).toBe('hornerito/test/logo-nuevo');
  });

  it('rechaza subir por el backend un purpose de subida directa', async () => {
    await expect(
      service.uploadFor('post', POST_ID, 'attachment', file(PNG), actor()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(cloudinary.upload).not.toHaveBeenCalled();
  });

  describe('subida directa de adjuntos de publicaciones', () => {
    const folder = `hornerito/test/${ORG_ID}/post/${POST_ID}`;
    const FILE_ID = `${folder}/55555555-5555-4555-8555-555555555555`;

    function resource(overrides: Record<string, unknown> = {}) {
      return {
        url: 'https://res.cloudinary.com/demo/video.mp4',
        publicId: FILE_ID,
        format: 'mp4',
        width: 1280,
        height: 720,
        bytes: 10_000_000,
        ...overrides,
      };
    }

    it('rechaza firmar a un rol sin permiso de contenido', async () => {
      await expect(
        service.signFor(
          'post',
          POST_ID,
          'attachment',
          actor(OrganizationMembershipRole.VOLUNTEER),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(cloudinary.signUpload).not.toHaveBeenCalled();
    });

    it('rechaza firmar para una publicación inexistente o de otra organización', async () => {
      repo.existsBy.mockResolvedValue(false);

      await expect(
        service.signFor('post', POST_ID, 'attachment', actor()),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.existsBy).toHaveBeenCalledWith({
        id: POST_ID,
        organizationId: ORG_ID,
      });
    });

    it('rechaza firmar si la publicación ya tiene 4 adjuntos', async () => {
      repo.countBy.mockResolvedValue(4);

      await expect(
        service.signFor('post', POST_ID, 'attachment', actor()),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(cloudinary.signUpload).not.toHaveBeenCalled();
    });

    it('rechaza firmar un purpose que se sube por el backend', async () => {
      await expect(
        service.signFor('organization', ORG_ID, 'logo', actor()),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('firma un único archivo con id propio en la carpeta de la publicación', async () => {
      await service.signFor('post', POST_ID, 'attachment', actor());

      const [publicId, formats] = cloudinary.signUpload.mock.calls[0] as [
        string,
        string[],
      ];
      expect(publicId).toMatch(new RegExp(`^${folder}/[0-9a-f-]{36}$`));
      expect(formats).toEqual(
        expect.arrayContaining(['jpg', 'png', 'webp', 'mp4', 'webm', 'mov']),
      );
    });

    it('rechaza confirmar un id que no tiene la forma que firma el backend', async () => {
      await expect(
        service.confirmFor(
          'post',
          POST_ID,
          'attachment',
          {
            publicId: `${folder}/elegido-por-el-cliente`,
            resourceType: 'image',
          },
          actor(),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(cloudinary.getResource).not.toHaveBeenCalled();
    });

    it('rechaza un tipo que no coincide con lo subido y borra el archivo', async () => {
      cloudinary.getResource.mockImplementation((_id: string, type: string) =>
        Promise.resolve(type === 'video' ? resource() : null),
      );

      await expect(
        service.confirmFor(
          'post',
          POST_ID,
          'attachment',
          { publicId: FILE_ID, resourceType: 'image' },
          actor(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(cloudinary.destroy).toHaveBeenCalledWith(FILE_ID, 'video');
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('rechaza confirmar dos veces el mismo archivo sin borrarlo', async () => {
      cloudinary.getResource.mockResolvedValue(resource());
      repo.save.mockRejectedValue(
        new QueryFailedError('INSERT', [], { code: '23505' } as never),
      );

      await expect(
        service.confirmFor(
          'post',
          POST_ID,
          'attachment',
          { publicId: FILE_ID, resourceType: 'video' },
          actor(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(cloudinary.destroy).not.toHaveBeenCalled();
    });

    it('rechaza confirmar un archivo fuera de la carpeta, sin consultar Cloudinary', async () => {
      await expect(
        service.confirmFor(
          'post',
          POST_ID,
          'attachment',
          {
            publicId: `hornerito/test/${OTHER_ORG_ID}/post/${POST_ID}/abc`,
            resourceType: 'video',
          },
          actor(),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(cloudinary.getResource).not.toHaveBeenCalled();
      expect(cloudinary.destroy).not.toHaveBeenCalled();
    });

    it('rechaza un video que supera el máximo y lo borra de Cloudinary', async () => {
      cloudinary.getResource.mockResolvedValue(resource({ bytes: 60_000_000 }));

      await expect(
        service.confirmFor(
          'post',
          POST_ID,
          'attachment',
          { publicId: FILE_ID, resourceType: 'video' },
          actor(),
        ),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(cloudinary.destroy).toHaveBeenCalledWith(FILE_ID, 'video');
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('rechaza un formato no permitido y lo borra de Cloudinary', async () => {
      cloudinary.getResource.mockResolvedValue(
        resource({ format: 'gif', bytes: 1000 }),
      );

      await expect(
        service.confirmFor(
          'post',
          POST_ID,
          'attachment',
          { publicId: FILE_ID, resourceType: 'image' },
          actor(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(cloudinary.destroy).toHaveBeenCalledWith(FILE_ID, 'image');
    });

    it('rechaza confirmar si mientras tanto se llenó el cupo, y lo borra', async () => {
      cloudinary.getResource.mockResolvedValue(resource());
      repo.countBy.mockResolvedValue(4);

      await expect(
        service.confirmFor(
          'post',
          POST_ID,
          'attachment',
          { publicId: FILE_ID, resourceType: 'video' },
          actor(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(cloudinary.destroy).toHaveBeenCalledWith(FILE_ID, 'video');
    });

    it('guarda el video con los datos que informa Cloudinary', async () => {
      cloudinary.getResource.mockResolvedValue(resource());

      const saved = await service.confirmFor(
        'post',
        POST_ID,
        'attachment',
        { publicId: FILE_ID, resourceType: 'video' },
        actor(),
      );

      expect(cloudinary.getResource).toHaveBeenCalledWith(FILE_ID, 'video');
      expect(saved).toEqual(
        expect.objectContaining({
          organizationId: ORG_ID,
          ownerType: 'post',
          ownerId: POST_ID,
          purpose: 'attachment',
          resourceType: 'video',
          url: 'https://res.cloudinary.com/demo/video.mp4',
          bytes: 10_000_000,
        }),
      );
      expect(cloudinary.destroy).not.toHaveBeenCalled();
    });

    it('al borrar todo lo de la publicación borra filas y archivos', async () => {
      repo.findBy = jest.fn().mockResolvedValue([
        { publicId: 'a', resourceType: 'image' },
        { publicId: 'b', resourceType: 'video' },
      ]);

      await service.removeAllFor('post', POST_ID);

      expect(repo.delete).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        ownerType: 'post',
        ownerId: POST_ID,
      });
      expect(cloudinary.destroy).toHaveBeenCalledWith('a', 'image');
      expect(cloudinary.destroy).toHaveBeenCalledWith('b', 'video');
    });
  });
});
