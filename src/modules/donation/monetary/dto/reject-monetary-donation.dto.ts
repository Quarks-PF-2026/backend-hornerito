import { IsString, Length } from 'class-validator';

export class RejectMonetaryDonationDto {
  @IsString()
  @Length(3, 255, {
    message: 'Contá en pocas palabras por qué rechazás la donación.',
  })
  rejectReason: string;
}
