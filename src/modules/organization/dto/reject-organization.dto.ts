import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RejectOrganizationDto {
  @IsString()
  @IsNotEmpty({ message: 'Ingresá el motivo del rechazo.' })
  @MaxLength(500, {
    message: 'El motivo no puede superar los 500 caracteres.',
  })
  reason: string;
}
