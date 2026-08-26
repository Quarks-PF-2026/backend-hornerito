import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { DonationController } from './donation.controller';
import { DonationService } from './donation.service';
import { DonationItem } from './entities/donation-item.entity';
import { Donation } from './entities/donation.entity';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([Donation, DonationItem])],
  controllers: [DonationController],
  providers: [DonationService],
})
export class DonationModule {}
