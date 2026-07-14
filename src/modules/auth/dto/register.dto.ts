import {
  Equals,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsString()
  @IsNotEmpty({ message: 'Ingresá tu nombre y apellido.' })
  name: string;

  @IsEmail({}, { message: 'El correo no tiene un formato válido.' })
  email: string;

  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  password: string;

  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  confirmPassword: string;

  @IsBoolean()
  @Equals(true, { message: 'Tenés que aceptar los términos y condiciones.' })
  acceptedTerms: boolean;
}
