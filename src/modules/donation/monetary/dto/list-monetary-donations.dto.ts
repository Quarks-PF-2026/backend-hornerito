import { IsEnum, IsOptional } from 'class-validator';
import { MonetaryDonationStatus } from '../../entities/monetary-donation.entity';

export class ListMonetaryDonationsDto {
  @IsOptional()
  @IsEnum(MonetaryDonationStatus, { message: 'Elegí un estado válido.' })
  status?: MonetaryDonationStatus;
}
