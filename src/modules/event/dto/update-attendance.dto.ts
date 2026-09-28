import { IsInt, Min } from 'class-validator';

export class UpdateAttendanceDto {
  @IsInt({ message: 'El conteo debe ser un número entero.' })
  @Min(0, { message: 'El conteo no puede ser negativo.' })
  count: number;
}
