import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const DEFAULT_PAGE_SIZE = 12;
export const MAX_PAGE_SIZE = 24;
export const MAX_WITHIN_DAYS = 30;

export class ListPublicQueryDto {
  /** Texto libre: nombre, descripción o dirección de la organización. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  /** Categoría de insumo (`SupplyCategory`), tal cual se guarda. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  category?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number;

  /** Solo necesidades que vencen entre hoy y hoy + N días (QK-108). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_WITHIN_DAYS)
  withinDays?: number;
}
