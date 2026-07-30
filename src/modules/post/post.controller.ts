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
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CONTENT_WRITER_ROLES } from '../organization/entities/organization-membership.entity';
import { TenantGuard } from '../tenant/tenant.guard';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { PostService } from './post.service';

@Controller('posts')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class PostController {
  constructor(private readonly postService: PostService) {}

  @Get()
  listMine() {
    return this.postService.listMine();
  }

  @Roles(...CONTENT_WRITER_ROLES)
  @HttpPost()
  create(@Body() dto: CreatePostDto) {
    return this.postService.create(dto);
  }

  @Roles(...CONTENT_WRITER_ROLES)
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePostDto) {
    return this.postService.update(id, dto);
  }

  @Roles(...CONTENT_WRITER_ROLES)
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.postService.remove(id);
  }
}
