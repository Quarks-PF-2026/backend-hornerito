import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CONTENT_WRITER_ROLES } from '../organization/entities/organization-membership.entity';
import { TenantGuard } from '../tenant/tenant.guard';
import { CollectionPointService } from './collection-point.service';
import { CreateCollectionPointDto } from './dto/create-collection-point.dto';
import { UpdateCollectionPointDto } from './dto/update-collection-point.dto';

@Controller('collection-points')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class CollectionPointController {
  constructor(
    private readonly collectionPointService: CollectionPointService,
  ) {}

  @Get()
  listMine() {
    return this.collectionPointService.list();
  }

  @Roles(...CONTENT_WRITER_ROLES)
  @Post()
  create(@Body() dto: CreateCollectionPointDto) {
    return this.collectionPointService.create(dto);
  }

  @Roles(...CONTENT_WRITER_ROLES)
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCollectionPointDto) {
    return this.collectionPointService.update(id, dto);
  }

  @Roles(...CONTENT_WRITER_ROLES)
  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.collectionPointService.deactivate(id);
  }

  @Roles(...CONTENT_WRITER_ROLES)
  @Patch(':id/activate')
  activate(@Param('id') id: string) {
    return this.collectionPointService.activate(id);
  }
}
