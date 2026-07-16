import { IsInt, Min } from 'class-validator';

export class UpdateProgressDto {
  @IsInt({ message: 'La cantidad cubierta debe ser un número entero.' })
  @Min(0, { message: 'La cantidad cubierta no puede ser negativa.' })
  coveredQuantity: number;
}
