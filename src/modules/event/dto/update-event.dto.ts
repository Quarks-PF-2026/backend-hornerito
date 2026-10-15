import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  ValidateIf,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { EventKind } from '../entities/event.entity';
import { DATE_ONLY_REGEX, TIME_HH_MM_REGEX } from './date-only.regex';

/**
 * Reemplaza a `@IsOptional`, que deja pasar `null` sin validar: un
 * `{"startTime": null}` llegaba al service y terminaba en 500 (NOT NULL o
 * `sortedWeekdays(null)`). Ausente = no se toca; `null` = 400.
 */
const isPresent = (_: object, value: unknown): boolean => value !== undefined;

/**
 * Todos los campos son opcionales (a diferencia del molde de
 * `UpdateVolunteerTypeDto`): un evento con asistencia registrada solo admite
 * cambiar el nombre y la hora, así que el body de esa edición no trae `kind`,
 * `startDate` ni `weekdays`.
 */
export class UpdateEventDto {
  @ValidateIf(isPresent)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'Ingresá el nombre del evento.' })
  @IsNotEmpty({ message: 'Ingresá el nombre del evento.' })
  @MaxLength(120, { message: 'El nombre no puede superar los 120 caracteres.' })
  name?: string;

  @ValidateIf(isPresent)
  @IsEnum(EventKind, { message: 'Elegí un tipo de evento válido.' })
  kind?: EventKind;

  @ValidateIf(isPresent)
  @IsDateString(
    { strict: true },
    { message: 'Ingresá una fecha de inicio válida (AAAA-MM-DD).' },
  )
  @Matches(DATE_ONLY_REGEX, {
    message: 'La fecha de inicio debe tener el formato AAAA-MM-DD.',
  })
  startDate?: string;

  // Si viene, se valida: el service decide si aplica según el kind resultante.
  @ValidateIf(isPresent)
  @IsArray({ message: 'Elegí los días de la semana del evento.' })
  @ArrayMinSize(1, { message: 'Elegí al menos un día de la semana.' })
  @ArrayUnique({ message: 'Los días de la semana no pueden repetirse.' })
  @IsInt({
    each: true,
    message: 'Los días de la semana deben ser números de 0 a 6.',
  })
  @Min(0, {
    each: true,
    message: 'Los días de la semana deben ser números de 0 a 6.',
  })
  @Max(6, {
    each: true,
    message: 'Los días de la semana deben ser números de 0 a 6.',
  })
  weekdays?: number[];

  @ValidateIf(isPresent)
  @Matches(TIME_HH_MM_REGEX, {
    message: 'Ingresá una hora de comienzo válida (HH:MM, 24 h).',
  })
  startTime?: string;
}
