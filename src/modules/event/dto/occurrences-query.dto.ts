import { IsDateString, IsOptional, Matches } from 'class-validator';
import { DATE_ONLY_REGEX } from './date-only.regex';

export class OccurrencesQueryDto {
  @IsOptional()
  @IsDateString(
    { strict: true },
    { message: 'La fecha "desde" no es válida (AAAA-MM-DD).' },
  )
  @Matches(DATE_ONLY_REGEX, {
    message: 'La fecha "desde" debe tener el formato AAAA-MM-DD.',
  })
  from?: string;

  @IsOptional()
  @IsDateString(
    { strict: true },
    { message: 'La fecha "hasta" no es válida (AAAA-MM-DD).' },
  )
  @Matches(DATE_ONLY_REGEX, {
    message: 'La fecha "hasta" debe tener el formato AAAA-MM-DD.',
  })
  to?: string;
}
