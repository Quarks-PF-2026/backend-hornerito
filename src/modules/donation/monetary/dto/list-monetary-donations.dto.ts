import { IsEnum, IsOptional } from 'class-validator';
import { DateRangeQueryDto } from '../../dto/list-donations.dto';
import { MonetaryDonationStatus } from '../../entities/monetary-donation.entity';

export class ListMonetaryDonationsDto extends DateRangeQueryDto {
  @IsOptional()
  @IsEnum(MonetaryDonationStatus, { message: 'Elegí un estado válido.' })
  status?: MonetaryDonationStatus;
}
