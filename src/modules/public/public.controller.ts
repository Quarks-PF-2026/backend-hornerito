import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ListPublicQueryDto } from './dto/list-public.query.dto';
import { PublicService } from './public.service';

/**
 * Directorio público: sin `@UseGuards`, se sirve a cualquier visitante sin
 * sesión. Solo expone organizaciones `validated` y campos ya curados por el
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

  @Get('needs')
  listNeeds(@Query() query: ListPublicQueryDto) {
    return this.publicService.listNeeds(query);
  }
}
