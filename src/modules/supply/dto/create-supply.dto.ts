import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { SupplyCategory, SupplyUnit } from '../entities/supply.entity';

export class CreateSupplyDto {
  @IsString()
  @IsNotEmpty({ message: 'Ingresá el nombre del insumo.' })
  name: string;

  @IsEnum(SupplyCategory, { message: 'Elegí una categoría válida.' })
  category: SupplyCategory;

  @IsEnum(SupplyUnit, { message: 'Elegí una unidad de medida válida.' })
  unit: SupplyUnit;
}
