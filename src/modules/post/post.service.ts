import { Injectable, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { MediaService, MediaView } from '../media/media.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { Post } from './entities/post.entity';

@Injectable()
export class PostService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly media: MediaService,
  ) {}

  async listMine(): Promise<(Post & { media: MediaView[] })[]> {
    const posts = await this.repo().find({
      where: { organizationId: this.orgId },
      order: { createdAt: 'DESC' },
    });
    const media = await this.media.listForOwners(
      'post',
      posts.map((post) => post.id),
    );
    return posts.map((post) => ({ ...post, media: media.get(post.id) ?? [] }));
  }

  async create(dto: CreatePostDto): Promise<Post> {
    const repo = this.repo();
    return repo.save(repo.create({ ...dto, organizationId: this.orgId }));
  }

  async update(id: string, dto: UpdatePostDto): Promise<Post> {
    const post = await this.findOrFail(id);
    post.title = dto.title;
    post.content = dto.content;
    return this.repo().save(post);
  }

  async remove(id: string): Promise<void> {
    await this.findOrFail(id);
    // `media` es polimórfica y no tiene FK a `posts`: el borrado en cascada
    // lo hace el service, incluidos los archivos en Cloudinary. Va primero:
    // si falla, la publicación sigue entera y se puede reintentar, en vez de
    // quedar adjuntos sin dueño que nadie lista ni borra.
    await this.media.removeAllFor('post', id);
    await this.repo().delete({ id, organizationId: this.orgId });
  }

  private async findOrFail(id: string): Promise<Post> {
    const post = await this.repo().findOneBy({
      id,
      organizationId: this.orgId,
    });
    if (!post) {
      throw new NotFoundException('La publicación no existe.');
    }
    return post;
  }

  private get orgId(): string {
    return this.tenantContext.organizationId;
  }

  private repo(): Repository<Post> {
    return this.tenantContext.getManager().getRepository(Post);
  }
}
