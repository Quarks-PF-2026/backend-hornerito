import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

// Igual que register.dto.ts: `+` opcional seguido de 8 a 15 dígitos, sin
// espacios ni guiones. Un teléfono con formato libre complica validarlo
// después contra WhatsApp/SMS si el proyecto lo necesita más adelante.
const PHONE_REGEX = /^\+?\d{8,15}$/;

export class UpdateProfileDto {
  // El trim va antes de @IsNotEmpty (que no recorta espacios por sí solo)
  // para que un nombre "   " no pase la validación como si tuviera contenido.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'Ingresá tu nombre y apellido.' })
  name: string;

  // @IsOptional() deja pasar tanto `undefined` (el campo no vino: no se
  // toca el teléfono actual) como `null` (el usuario lo borra a propósito).
  // Solo si llega un string se valida el formato.
  @IsOptional()
  @Matches(PHONE_REGEX, {
    message:
      'El teléfono debe tener entre 8 y 15 dígitos, sin espacios ni guiones.',
  })
  phone?: string | null;
}
