import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { EventKind } from '../entities/event.entity';
import { DATE_ONLY_REGEX } from './date-only.regex';

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
}
