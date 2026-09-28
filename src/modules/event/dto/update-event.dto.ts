import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { EventKind } from '../entities/event.entity';
import { DATE_ONLY_REGEX } from './date-only.regex';

/**
 * Los tres campos son opcionales (a diferencia del molde de
 * `UpdateVolunteerTypeDto`): un evento con asistencia registrada solo admite
 * renombrarse, así que el body de esa edición no trae `kind` ni `startDate`.
 */
export class UpdateEventDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'Ingresá el nombre del evento.' })
  @IsNotEmpty({ message: 'Ingresá el nombre del evento.' })
  @MaxLength(120, { message: 'El nombre no puede superar los 120 caracteres.' })
  name?: string;

  @IsOptional()
  @IsEnum(EventKind, { message: 'Elegí un tipo de evento válido.' })
  kind?: EventKind;

  @IsOptional()
  @IsDateString(
    { strict: true },
    { message: 'Ingresá una fecha de inicio válida (AAAA-MM-DD).' },
  )
  @Matches(DATE_ONLY_REGEX, {
    message: 'La fecha de inicio debe tener el formato AAAA-MM-DD.',
  })
  startDate?: string;
}
