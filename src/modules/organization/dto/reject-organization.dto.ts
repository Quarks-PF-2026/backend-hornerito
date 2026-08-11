import { IsNotEmpty, IsString } from 'class-validator';

export class RejectOrganizationDto {
  @IsString()
  @IsNotEmpty({ message: 'Ingresá el motivo del rechazo.' })
  reason: string;
}