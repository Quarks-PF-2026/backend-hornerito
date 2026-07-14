import { IsEmail, IsNotEmpty } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'El correo no tiene un formato válido.' })
  email: string;

  @IsNotEmpty({ message: 'Ingresá tu contraseña.' })
  password: string;
}
