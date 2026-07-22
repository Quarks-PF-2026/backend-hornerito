import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class ScheduleDayDto {
  @IsInt({ message: 'Día de la semana inválido.' })
  @Min(0, { message: 'Día de la semana inválido.' })
  @Max(6, { message: 'Día de la semana inválido.' })
  day: number;

  @IsBoolean({ message: 'Indicá si el día está cerrado.' })
  closed: boolean;

  @ValidateIf((o: ScheduleDayDto) => !o.closed)
  @Matches(HHMM, { message: 'La hora de apertura debe tener formato HH:mm.' })
  open: string | null;

  @ValidateIf((o: ScheduleDayDto) => !o.closed)
  @Matches(HHMM, { message: 'La hora de cierre debe tener formato HH:mm.' })
  close: string | null;
}

export class CreateCollectionPointDto {
  @IsString({ message: 'Ingresá un nombre.' })
  @Length(3, 80, { message: 'El nombre debe tener entre 3 y 80 caracteres.' })
  name: string;

  @IsString({ message: 'Ingresá una dirección.' })
  @Length(5, 200, {
    message: 'La dirección debe tener entre 5 y 200 caracteres.',
  })
  addressLine: string;

  @IsLatitude({ message: 'Marcá la ubicación en el mapa.' })
  latitude: number;

  @IsLongitude({ message: 'Marcá la ubicación en el mapa.' })
  longitude: number;

  @IsString({ message: 'Ingresá un teléfono de contacto.' })
  @Length(6, 20, { message: 'El teléfono debe tener entre 6 y 20 caracteres.' })
  @Matches(/^[0-9+()\s-]+$/, {
    message: 'El teléfono tiene caracteres inválidos.',
  })
  phone: string;

  @IsOptional()
  @IsEmail({}, { message: 'Ingresá un correo válido.' })
  email?: string | null;

  @IsOptional()
  @IsString({ message: 'El nombre de referente es inválido.' })
  @Length(1, 80, {
    message: 'El nombre de referente no puede superar los 80 caracteres.',
  })
  contactName?: string | null;

  @IsArray({ message: 'Cargá el horario de atención.' })
  @ArrayMinSize(7, {
    message: 'El horario debe cubrir los 7 días de la semana.',
  })
  @ArrayMaxSize(7, {
    message: 'El horario debe cubrir los 7 días de la semana.',
  })
  @ValidateNested({ each: true })
  @Type(() => ScheduleDayDto)
  schedule: ScheduleDayDto[];
}
