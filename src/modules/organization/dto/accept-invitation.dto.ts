import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

// name y password solo hacen falta cuando el correo invitado todavía no tiene
// cuenta; si ya existe, aceptar solo crea la membresía.
export class AcceptInvitationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Ingresá tu nombre y apellido.' })
  name?: string;

  @IsOptional()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  password?: string;
}
