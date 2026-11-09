import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ListPublicQueryDto } from './dto/list-public.query.dto';
import { PublicService } from './public.service';

/**
 * Directorio público: se sirve a cualquier visitante sin sesión; las rutas de
 * historias aceptan sesión opcional para personalizarse (`OptionalJwtAuthGuard`). Solo expone organizaciones `validated` y campos ya curados por el
 * service — nada de ownerId, motivos de rechazo ni datos de miembros. Los
 * donantes (ranking y perfil, QK-114/QK-110) salen con nombre y montos, nunca
 * con contacto.
 */
@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('organizations')
  listOrganizations(@Query() query: ListPublicQueryDto) {
    return this.publicService.listOrganizations(query);
  }

  @Get('localities')
  listLocalities() {
    return this.publicService.listLocalities();
  }

  @Get('organizations/:id')
  getOrganization(@Param('id', ParseUUIDPipe) id: string) {
    return this.publicService.getOrganization(id);
  }

  /** `top` antes que `:userId`: si no, Nest lo intentaría parsear como uuid. */
  @Get('donors/top')
  topDonors() {
    return this.publicService.topDonors();
  }

  @Get('donors/:userId')
  getDonor(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.publicService.getDonor(userId);
  }

  /** Con sesión, se omiten las historias que el usuario ya vio (QK-111). */
  @Get('stories')
  @UseGuards(OptionalJwtAuthGuard)
  listStories(@CurrentUser() user: AuthenticatedUser | undefined) {
    return this.publicService.listStories(user?.id);
  }

  @Post('stories/:id/view')
  @HttpCode(204)
  @UseGuards(OptionalJwtAuthGuard)
  viewStory(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.publicService.viewStory(id, user?.id);
  }

  @Get('needs')
  listNeeds(@Query() query: ListPublicQueryDto) {
    return this.publicService.listNeeds(query);
  }
}
