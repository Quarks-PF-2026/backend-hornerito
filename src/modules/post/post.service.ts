import { Injectable, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { TenantContextService } from '../tenant/tenant-context.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { Post } from './entities/post.entity';

@Injectable()
export class PostService {
  constructor(private readonly tenantContext: TenantContextService) {}

  async listMine(): Promise<Post[]> {
    return this.repo().find({
      where: { organizationId: this.orgId },
      order: { createdAt: 'DESC' },
    });
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
