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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../tenant/tenant.guard';
import { CollectionPointService } from './collection-point.service';
import { CreateCollectionPointDto } from './dto/create-collection-point.dto';
import { UpdateCollectionPointDto } from './dto/update-collection-point.dto';

@Controller('collection-points')
@UseGuards(JwtAuthGuard, TenantGuard)
export class CollectionPointController {
  constructor(
    private readonly collectionPointService: CollectionPointService,
  ) {}

  @Get()
  listMine() {
    return this.collectionPointService.list();
  }

  @Post()
  create(@Body() dto: CreateCollectionPointDto) {
    return this.collectionPointService.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCollectionPointDto) {
    return this.collectionPointService.update(id, dto);
  }

  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.collectionPointService.deactivate(id);
  }

  @Patch(':id/activate')
  activate(@Param('id') id: string) {
    return this.collectionPointService.activate(id);
  }
}
