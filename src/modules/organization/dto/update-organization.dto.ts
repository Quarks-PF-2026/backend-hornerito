import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import { CreateOrganizationDto } from './create-organization.dto';

export class UpdateOrganizationDto extends CreateOrganizationDto {
  /**
   * Opcional para no romper a los clientes que ya mandan el perfil sin este
   * campo: si no viene, el valor guardado no se toca.
   */
  @IsOptional()
  @IsBoolean()
  seeksVolunteers?: boolean;

  /**
   * Datos bancarios donde recibir donaciones económicas (QK-20). Todos
   * opcionales y con la misma semántica que `seeksVolunteers`: si no vienen, no
   * se tocan. Cargar `paymentAlias` es lo que habilita "Donar dinero" en la
   * ficha pública; se acepta string vacío para poder apagarlo.
   */
  @IsOptional()
  @IsString()
  @Length(0, 60, {
    message: 'El alias o CBU no puede superar los 60 caracteres.',
  })
  paymentAlias?: string;

  @IsOptional()
  @IsString()
  @Length(0, 120, {
    message: 'El titular no puede superar los 120 caracteres.',
  })
  paymentHolder?: string;

  @IsOptional()
  @IsString()
  @Length(0, 13, { message: 'El CUIT no puede superar los 13 caracteres.' })
  paymentCuit?: string;

  @IsOptional()
  @IsString()
  @Length(0, 80, { message: 'El banco no puede superar los 80 caracteres.' })
  paymentBank?: string;
}
