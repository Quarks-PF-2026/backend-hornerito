import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Ingresá tu contraseña actual.' })
  currentPassword: string;

  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  newPassword: string;

  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  confirmNewPassword: string;
}
