import { IsOptional, Matches } from 'class-validator';
import { DateRange } from '../date-range';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Filtros comunes a los dos historiales de donaciones. */
export class DateRangeQueryDto implements DateRange {
  @IsOptional()
  @Matches(ISO_DAY, { message: 'El "desde" tiene que ser una fecha AAAA-MM-DD.' })
  from?: string;

  @IsOptional()
  @Matches(ISO_DAY, { message: 'El "hasta" tiene que ser una fecha AAAA-MM-DD.' })
  to?: string;
}

/** Historial de donaciones presenciales: solo se filtra por fecha. */
export class ListDonationsDto extends DateRangeQueryDto {}
