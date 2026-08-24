import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CreateVolunteerRequestDto } from './dto/create-volunteer-request.dto';
import { VolunteerRequestService } from './volunteer-request.service';

/**
 * Alta anónima de una solicitud de voluntario (QK-16): sin `@UseGuards`, la
 * llama un visitante sin sesión desde la ficha pública. Precedente del mismo
 * molde en el repo: `InvitationController`, público y viviendo en su módulo de
 * dominio en vez de en `public/`, que se mantiene de solo lectura.
 *
 * Riesgo aceptado por decisión del equipo: no hay rate limiting ni
 * confirmación del correo por token, así que el endpoint es spameable. Ver
 * `PROYECTO.md`. La contención real es que la cuenta no se crea acá: nace
 * recién al aceptar la invitación, que exige acceso a la casilla.
 */
@Controller('public/organizations/:organizationId/volunteer-requests')
export class PublicVolunteerRequestController {
  constructor(private readonly requests: VolunteerRequestService) {}

  @Post()
  submit(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateVolunteerRequestDto,
  ) {
    return this.requests.submit(organizationId, dto);
  }
}
