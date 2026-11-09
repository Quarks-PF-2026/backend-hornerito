import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import {
  DonationMethod,
  MIN_DONATION_AMOUNT,
} from '../../entities/monetary-donation.entity';

/**
 * Lo que declara el donante desde la ficha pública. Llega por `multipart` junto
 * con el comprobante, así que todos los campos viajan como string: el `@Type`
 * del monto es lo que le da de comer al `ValidationPipe` global, que ya corre
 * con `transform: true`.
 */
export class CreateMonetaryDonationDto {
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'Ingresá un monto válido, con hasta dos decimales.' },
  )
  @Min(MIN_DONATION_AMOUNT, {
    message: `El monto mínimo es $${MIN_DONATION_AMOUNT}.`,
  })
  amount: number;

  @IsEnum(DonationMethod, { message: 'Elegí un medio de pago válido.' })
  method: DonationMethod;

  @IsOptional()
  @IsString()
  @Length(1, 60, {
    message: 'El número de operación no puede superar los 60 caracteres.',
  })
  operationNumber?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80, { message: 'El nombre no puede superar los 80 caracteres.' })
  donorName?: string;

  /** Opcional a propósito: sin email la donación es anónima y no recibe aviso. */
  @IsOptional()
  @IsEmail({}, { message: 'Ingresá un email válido o dejalo vacío.' })
  @Length(1, 120)
  donorContact?: string;

  /**
   * Anónima frente al público (QK-113): solo tiene efecto con sesión, porque
   * sin cuenta la donación no figura en ningún ranking del que esconderse. Por
   * multipart llega como 'true'/'false'; cualquier otro valor queda como está y
   * lo rechaza `@IsBoolean`.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean({ message: 'Indicá si la donación es anónima con sí o no.' })
  isAnonymous?: boolean;
}
