import {
  BadRequestException,
  ForbiddenException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { OrganizationMembershipRole } from '../organization/entities/organization-membership.entity';
import { TenantContextService } from '../tenant/tenant-context.service';
import { CloudinaryService } from './cloudinary.service';
import { Media } from './entities/media.entity';
import { MediaActor, MediaService } from './media.service';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

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
  };
  let cloudinary: { upload: jest.Mock; destroy: jest.Mock };

  beforeEach(() => {
    repo = {
      find: jest.fn(),
      findOneBy: jest.fn().mockResolvedValue(null),
      create: jest.fn((value: Partial<Media>) => value as Media),
      save: jest.fn((value: Media) =>
        Promise.resolve({ ...value, id: value.id ?? 'media-1' }),
      ),
      delete: jest.fn(),
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
});
