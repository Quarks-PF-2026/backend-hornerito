import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RejectVolunteerRequestDto {
  @IsString()
  @IsNotEmpty({ message: 'Ingresá el motivo del rechazo.' })
  @MaxLength(300, { message: 'El motivo no puede superar los 300 caracteres.' })
  reason: string;
}
