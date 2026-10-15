import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { EventKind } from '../entities/event.entity';
import { DATE_ONLY_REGEX, TIME_HH_MM_REGEX } from './date-only.regex';

export class CreateEventDto {
  // El trim va antes de @IsNotEmpty (que no recorta espacios por sí solo)
  // para que un nombre "   " no pase la validación como si tuviera contenido.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'Ingresá el nombre del evento.' })
  @IsNotEmpty({ message: 'Ingresá el nombre del evento.' })
  @MaxLength(120, { message: 'El nombre no puede superar los 120 caracteres.' })
  name: string;

  @IsEnum(EventKind, { message: 'Elegí un tipo de evento válido.' })
  kind: EventKind;

  @IsDateString(
    { strict: true },
    { message: 'Ingresá una fecha de inicio válida (AAAA-MM-DD).' },
  )
  @Matches(DATE_ONLY_REGEX, {
    message: 'La fecha de inicio debe tener el formato AAAA-MM-DD.',
  })
  startDate: string;

  // Solo el periódico lleva días; al extraordinario el service le fuerza null.
  @ValidateIf((o: CreateEventDto) => o.kind === EventKind.PERIODIC)
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
  weekdays: number[];

  @Matches(TIME_HH_MM_REGEX, {
    message: 'Ingresá una hora de comienzo válida (HH:MM, 24 h).',
  })
  startTime: string;
}
