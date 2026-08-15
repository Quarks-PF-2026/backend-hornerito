import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from 'class-validator';

export class CreateDonationItemDto {
  @IsUUID(undefined, { message: 'Elegí un insumo válido.' })
  supplyId: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'Elegí una necesidad válida.' })
  needId?: string | null;

  @IsInt({ message: 'La cantidad debe ser un número entero.' })
  @IsPositive({ message: 'La cantidad debe ser mayor a cero.' })
  quantity: number;
}

export class CreateDonationDto {
  @IsOptional()
  @IsUUID(undefined, { message: 'Elegí un punto de recolección válido.' })
  collectionPointId?: string | null;

  @IsOptional()
  @IsString({ message: 'El nombre del donante no es válido.' })
  @Length(1, 80, {
    message: 'El nombre del donante no puede superar los 80 caracteres.',
  })
  donorName?: string | null;

  @IsOptional()
  @IsString({ message: 'El contacto del donante no es válido.' })
  @Length(1, 120, {
    message: 'El contacto no puede superar los 120 caracteres.',
  })
  donorContact?: string | null;

  @IsArray({ message: 'Cargá los insumos donados.' })
  @ArrayMinSize(1, { message: 'Agregá al menos un insumo a la donación.' })
  @ValidateNested({ each: true })
  @Type(() => CreateDonationItemDto)
  items: CreateDonationItemDto[];
}
