import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile as UploadedFileParam,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { MAX_UPLOAD_BYTES } from '../../media/media-purposes';
import { UploadedFile } from '../../media/media.service';
import { CreateMonetaryDonationDto } from './dto/create-monetary-donation.dto';
import { MonetaryDonationService } from './monetary-donation.service';

/**
 * Alta pública de una donación económica (QK-20): la llama un visitante desde
 * la ficha pública, después de haber transferido por su banco. Mismo molde que
 * `PublicVolunteerRequestController`.
 *
 * La sesión es opcional (QK-113): con un token válido la donación queda
 * asociada a la cuenta y puede marcarse anónima frente al público; sin token, o
 * con uno vencido o inválido, se dona como visitante. `OptionalJwtAuthGuard` no
 * corta nunca la request, así que esta ruta sigue abierta para cualquiera.
 *
 * Riesgo aceptado por decisión del equipo: no hay rate limiting, así que el
 * endpoint es spameable. Ver `PROYECTO.md`. La contención real es que una
 * donación declarada no vale nada hasta que un owner o admin la confirma contra
 * el extracto bancario: lo que se puede ensuciar es la bandeja del panel, no la
 * contabilidad.
 *
 * Va por `multipart` porque el comprobante viaja en el mismo request: declarar
 * y adjuntar son un solo acto para el donante.
 */
@Controller('public/organizations/:organizationId/donations')
export class PublicMonetaryDonationController {
  constructor(private readonly donations: MonetaryDonationService) {}

  @Post()
  @UseGuards(OptionalJwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('receipt', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  declare(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateMonetaryDonationDto,
    @UploadedFileParam() receipt: UploadedFile | undefined,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.donations.declare(organizationId, dto, receipt, user?.id);
  }
}
