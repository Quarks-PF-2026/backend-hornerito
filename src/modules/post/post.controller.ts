import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post as HttpPost,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../tenant/tenant.guard';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { PostService } from './post.service';

@Controller('posts')
@UseGuards(JwtAuthGuard, TenantGuard)
export class PostController {
  constructor(private readonly postService: PostService) {}

  @Get()
  listMine() {
    return this.postService.listMine();
  }

  @HttpPost()
  create(@Body() dto: CreatePostDto) {
    return this.postService.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePostDto) {
    return this.postService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.postService.remove(id);
  }
}
