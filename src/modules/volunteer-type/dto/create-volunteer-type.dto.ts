import { IsString, Length } from 'class-validator';

export class CreateVolunteerTypeDto {
  @IsString({ message: 'Ingresá el nombre del tipo de voluntario.' })
  @Length(2, 60, { message: 'El nombre debe tener entre 2 y 60 caracteres.' })
  name: string;
}
