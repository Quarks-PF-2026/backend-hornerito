import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';

/**
 * Entra por un endpoint sin autenticación: es el límite de confianza de esta
 * historia, así que la validación acá no se recorta. El `ValidationPipe`
 * global corre con `whitelist: true`, así que los campos de más se descartan.
 */
export class CreateVolunteerRequestDto {
  @IsString()
  @Length(2, 80, { message: 'Ingresá tu nombre.' })
  name: string;

  @IsEmail({}, { message: 'Ingresá un correo válido.' })
  @MaxLength(120)
  email: string;

  @IsOptional()
  @IsString()
  @Length(6, 30, { message: 'El teléfono no es válido.' })
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, {
    message: 'El mensaje no puede superar los 500 caracteres.',
  })
  message?: string;

  /** Postulación a una actividad concreta. Excluyente con `volunteerTypeId`. */
  @IsOptional()
  @IsUUID()
  opportunityId?: string;

  /** Postulación a la organización, eligiendo en qué quiere ayudar. */
  @IsOptional()
  @IsUUID()
  volunteerTypeId?: string;
}
