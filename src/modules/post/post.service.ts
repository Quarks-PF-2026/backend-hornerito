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
    const repo = await this.repo();
    return repo.find({ order: { createdAt: 'DESC' } });
  }

  async create(dto: CreatePostDto): Promise<Post> {
    const repo = await this.repo();
    return repo.save(repo.create(dto));
  }

  async update(id: string, dto: UpdatePostDto): Promise<Post> {
    const post = await this.findOrFail(id);
    post.title = dto.title;
    post.content = dto.content;
    const repo = await this.repo();
    return repo.save(post);
  }

  async remove(id: string): Promise<void> {
    await this.findOrFail(id);
    const repo = await this.repo();
    await repo.delete(id);
  }

  private async findOrFail(id: string): Promise<Post> {
    const repo = await this.repo();
    const post = await repo.findOneBy({ id });
    if (!post) {
      throw new NotFoundException('La publicación no existe.');
    }
    return post;
  }

  private async repo(): Promise<Repository<Post>> {
    const manager = await this.tenantContext.getManager();
    return manager.getRepository(Post);
  }
}
