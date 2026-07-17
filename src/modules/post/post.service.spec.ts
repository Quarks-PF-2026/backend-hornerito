/* eslint-disable @typescript-eslint/unbound-method -- jest.fn() mocks are safe to reference unbound */
import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { TenantContextService } from '../tenant/tenant-context.service';
import { Post } from './entities/post.entity';
import { PostService } from './post.service';

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'post-1',
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

  beforeEach(() => {
    postRepo = {
      find: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn((data) => data as Post),
      save: jest.fn(async (entity) => entity as Post),
      delete: jest.fn(),
    } as unknown as jest.Mocked<Repository<Post>>;
    tenantContext = {
      getManager: jest.fn().mockResolvedValue({
        getRepository: () => postRepo,
      }),
    } as unknown as jest.Mocked<TenantContextService>;
    service = new PostService(tenantContext);
  });

  describe('listMine', () => {
    it('returns every post in the tenant schema, newest first', async () => {
      const posts = [makePost(), makePost({ id: 'post-2' })];
      postRepo.find.mockResolvedValue(posts);

      const result = await service.listMine();

      expect(result).toEqual(posts);
      expect(postRepo.find).toHaveBeenCalledWith({
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('create', () => {
    it('creates a post', async () => {
      const dto = { title: 'Nueva publicación', content: 'Contenido' };

      const result = await service.create(dto);

      expect(result).toEqual(dto);
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

      expect(postRepo.delete).toHaveBeenCalledWith('post-1');
    });
  });
});
