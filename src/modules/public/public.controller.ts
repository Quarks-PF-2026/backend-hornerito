import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ListPublicQueryDto } from './dto/list-public.query.dto';
import { PublicService } from './public.service';

/**
 * Directorio público: sin `@UseGuards`, se sirve a cualquier visitante sin
 * sesión. Solo expone organizaciones `validated` y campos ya curados por el
 * service — nada de ownerId, motivos de rechazo ni datos de miembros.
 */
@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('organizations')
  listOrganizations(@Query() query: ListPublicQueryDto) {
    return this.publicService.listOrganizations(query);
  }

  @Get('organizations/:id')
  getOrganization(@Param('id', ParseUUIDPipe) id: string) {
    return this.publicService.getOrganization(id);
  }

  @Get('needs')
  listNeeds(@Query() query: ListPublicQueryDto) {
    return this.publicService.listNeeds(query);
  }
}
