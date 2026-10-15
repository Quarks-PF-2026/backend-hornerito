/* eslint-disable @typescript-eslint/unbound-method -- jest.fn() mocks are safe to reference unbound */
import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { MediaService } from '../media/media.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { Post } from './entities/post.entity';
import { PostService } from './post.service';

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'post-1',
    organizationId: 'org-1',
    title: 'Gracias por las donaciones',
    content: 'Seguimos necesitando leche y aceite.',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('PostService', () => {
  let service: PostService;
  let postRepo: jest.Mocked<Repository<Post>>;
  let tenantContext: jest.Mocked<TenantContextService>;
  let media: { listForOwners: jest.Mock; removeAllFor: jest.Mock };

  beforeEach(() => {
    postRepo = {
      find: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn((data) => data as Post),
      save: jest.fn((entity) => Promise.resolve(entity as Post)),
      delete: jest.fn(),
    } as unknown as jest.Mocked<Repository<Post>>;
    tenantContext = {
      organizationId: 'org-1',
      getManager: jest.fn().mockReturnValue({
        getRepository: () => postRepo,
      }),
    } as unknown as jest.Mocked<TenantContextService>;
    media = {
      listForOwners: jest.fn().mockResolvedValue(new Map()),
      removeAllFor: jest.fn().mockResolvedValue(undefined),
    };
    service = new PostService(tenantContext, media as unknown as MediaService);
  });

  describe('listMine', () => {
    it('returns every post of the organization, newest first', async () => {
      const posts = [makePost(), makePost({ id: 'post-2' })];
      postRepo.find.mockResolvedValue(posts);

      const result = await service.listMine();

      expect(result).toEqual(posts.map((post) => ({ ...post, media: [] })));
      expect(postRepo.find).toHaveBeenCalledWith({
        where: { organizationId: 'org-1' },
        order: { createdAt: 'DESC' },
      });
    });

    it('adjunta a cada publicación sus archivos, en una sola consulta', async () => {
      postRepo.find.mockResolvedValue([makePost(), makePost({ id: 'post-2' })]);
      const attachment = {
        id: 'media-1',
        url: 'https://cdn/a.jpg',
        resourceType: 'image' as const,
        width: 10,
        height: 10,
      };
      media.listForOwners.mockResolvedValue(
        new Map([['post-2', [attachment]]]),
      );

      const result = await service.listMine();

      expect(media.listForOwners).toHaveBeenCalledWith('post', [
        'post-1',
        'post-2',
      ]);
      expect(result[0].media).toEqual([]);
      expect(result[1].media).toEqual([attachment]);
    });
  });

  describe('create', () => {
    it('creates a post', async () => {
      const dto = { title: 'Nueva publicación', content: 'Contenido' };

      const result = await service.create(dto);

      expect(result).toEqual({ ...dto, organizationId: 'org-1' });
      expect(postRepo.save).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the post does not exist', async () => {
      postRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.update('missing-id', { title: 'T', content: 'C' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates an existing post', async () => {
      postRepo.findOneBy.mockResolvedValue(makePost());

      const result = await service.update('post-1', {
        title: 'Título editado',
        content: 'Contenido editado',
      });

      expect(result.title).toBe('Título editado');
      expect(result.content).toBe('Contenido editado');
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when the post does not exist', async () => {
      postRepo.findOneBy.mockResolvedValue(null);

      await expect(service.remove('missing-id')).rejects.toThrow(
        NotFoundException,
      );
      expect(postRepo.delete).not.toHaveBeenCalled();
    });

    it('deletes an existing post', async () => {
      postRepo.findOneBy.mockResolvedValue(makePost());

      await service.remove('post-1');

      expect(postRepo.delete).toHaveBeenCalledWith({
        id: 'post-1',
        organizationId: 'org-1',
      });
    });

    it('borra también los adjuntos de la publicación', async () => {
      postRepo.findOneBy.mockResolvedValue(makePost());

      await service.remove('post-1');

      expect(media.removeAllFor).toHaveBeenCalledWith('post', 'post-1');
      // Primero los adjuntos: si fallan, la publicación queda para reintentar.
      expect(media.removeAllFor.mock.invocationCallOrder[0]).toBeLessThan(
        postRepo.delete.mock.invocationCallOrder[0],
      );
    });

    it('no toca adjuntos si la publicación no existe', async () => {
      postRepo.findOneBy.mockResolvedValue(null);

      await expect(service.remove('missing-id')).rejects.toThrow(
        NotFoundException,
      );
      expect(media.removeAllFor).not.toHaveBeenCalled();
    });
  });
});
