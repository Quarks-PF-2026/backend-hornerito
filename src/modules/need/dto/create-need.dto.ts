import { IsDateString, IsInt, IsPositive, IsUUID } from 'class-validator';

export class CreateNeedDto {
  @IsUUID(undefined, { message: 'Elegí un insumo válido.' })
  supplyId: string;

  @IsInt({ message: 'La cantidad requerida debe ser un número entero.' })
  @IsPositive({ message: 'La cantidad requerida debe ser mayor a cero.' })
  requiredQuantity: number;

  @IsDateString({}, { message: 'Elegí una fecha límite válida.' })
  deadline: string;
}
