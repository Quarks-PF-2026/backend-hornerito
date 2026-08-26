import { IsBoolean, IsOptional } from 'class-validator';
import { CreateOrganizationDto } from './create-organization.dto';

export class UpdateOrganizationDto extends CreateOrganizationDto {
  /**
   * Opcional para no romper a los clientes que ya mandan el perfil sin este
   * campo: si no viene, el valor guardado no se toca.
   */
  @IsOptional()
  @IsBoolean()
  seeksVolunteers?: boolean;
}
