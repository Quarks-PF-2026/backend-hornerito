import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { OrganizationMembership } from '../organization/entities/organization-membership.entity';
import { TenantGuard } from '../tenant/tenant.guard';
import { MAX_UPLOAD_BYTES } from './media-purposes';
import {
  MediaActor,
  MediaService,
  UploadedFile as File,
} from './media.service';

interface MediaRequest {
  user: { id: string; orgId: string };
  membership: OrganizationMembership;
}

/**
 * Los roles habilitados dependen del `ownerType` de la URL, así que no se
 * pueden declarar con `@Roles()` estático: la comprobación vive en el service,
 * contra la membresía que dejó `TenantGuard` en el request.
 */
@Controller('media')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get(':ownerType/:ownerId')
  list(
    @Req() req: MediaRequest,
    @Param('ownerType') ownerType: string,
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
  ) {
    return this.mediaService.listFor(ownerType, ownerId, actorOf(req));
  }

  @Post(':ownerType/:ownerId/:purpose')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  upload(
    @Req() req: MediaRequest,
    @Param('ownerType') ownerType: string,
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @Param('purpose') purpose: string,
    @UploadedFile() file: File | undefined,
  ) {
    return this.mediaService.uploadFor(
      ownerType,
      ownerId,
      purpose,
      file,
      actorOf(req),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Req() req: MediaRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.mediaService.remove(id, actorOf(req));
  }
}

function actorOf(req: MediaRequest): MediaActor {
  return {
    userId: req.user.id,
    orgId: req.membership.organizationId,
    role: req.membership.role,
  };
}
