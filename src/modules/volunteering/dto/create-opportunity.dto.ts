import {
  IsDateString,
  IsInt,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreateOpportunityDto {
  @IsString({ message: 'Ingresá un título.' })
  @Length(3, 80, { message: 'El título debe tener entre 3 y 80 caracteres.' })
  title: string;

  @IsString({ message: 'Ingresá una descripción.' })
  @Length(10, 1000, {
    message: 'La descripción debe tener entre 10 y 1000 caracteres.',
  })
  description: string;

  @IsDateString(
    {},
    { message: 'Ingresá una fecha y hora válidas para la actividad.' },
  )
  startsAt: string;

  @IsString({ message: 'Ingresá el lugar de la actividad.' })
  @Length(3, 200, { message: 'El lugar debe tener entre 3 y 200 caracteres.' })
  location: string;

  @IsInt({ message: 'Los cupos deben ser un número entero.' })
  @Min(1, { message: 'La actividad tiene que tener al menos un cupo.' })
  @Max(1000, { message: 'Los cupos no pueden superar los 1000.' })
  capacity: number;
}
