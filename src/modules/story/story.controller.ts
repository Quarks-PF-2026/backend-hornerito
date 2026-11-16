import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CONTENT_WRITER_ROLES } from '../organization/entities/organization-membership.entity';
import { TenantGuard } from '../tenant/tenant.guard';
import { CreateStoryDto } from './dto/create-story.dto';
import { SignStoryDto } from './dto/sign-story.dto';
import { StoryService } from './story.service';

/** Panel de historias (QK-111). Las lecturas públicas viven en `PublicController`. */
@Controller('stories')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(...CONTENT_WRITER_ROLES)
export class StoryController {
  constructor(private readonly stories: StoryService) {}

  @Get()
  list() {
    return this.stories.list();
  }

  /** Subida directa, paso 1: firma para subir del navegador a Cloudinary. */
  @Post('signature')
  @HttpCode(200)
  sign(@Body() dto: SignStoryDto) {
    return this.stories.sign(dto.resourceType);
  }

  @Post()
  create(@Body() dto: CreateStoryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.stories.create(dto, user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.stories.remove(id);
  }
}
