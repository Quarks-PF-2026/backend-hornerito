import { IsEmail } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'El correo no tiene un formato válido.' })
  email: string;
}
