import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { User } from '../auth/entities/user.entity';
import { MediaModule } from '../media/media.module';
import { OrganizationMembership } from '../organization/entities/organization-membership.entity';
import { Organization } from '../organization/entities/organization.entity';
import { DonationController } from './donation.controller';
import { DonationService } from './donation.service';
import { DonationItem } from './entities/donation-item.entity';
import { Donation } from './entities/donation.entity';
import { InPersonDonation } from './entities/in-person-donation.entity';
import { MonetaryDonation } from './entities/monetary-donation.entity';
import { MonetaryDonationController } from './monetary/monetary-donation.controller';
import { MonetaryDonationService } from './monetary/monetary-donation.service';
import { PublicMonetaryDonationController } from './monetary/public-monetary-donation.controller';

@Module({
  imports: [
    AuthModule,
    MediaModule,
    TypeOrmModule.forFeature([
      Donation,
      InPersonDonation,
      MonetaryDonation,
      DonationItem,
      Organization,
      OrganizationMembership,
      User,
    ]),
  ],
  controllers: [
    DonationController,
    MonetaryDonationController,
    PublicMonetaryDonationController,
  ],
  providers: [DonationService, MonetaryDonationService],
})
export class DonationModule {}
