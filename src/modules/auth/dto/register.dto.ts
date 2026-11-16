import {
  Equals,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { AccountType } from '../entities/user.entity';

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

  // Opcional para no romper clientes que no lo mandan: sin dato, la cuenta
  // nace donante, que es el caso mayoritario.
  @IsOptional()
  @IsEnum(AccountType, { message: 'Elegí un tipo de cuenta válido.' })
  accountType?: AccountType;
}
