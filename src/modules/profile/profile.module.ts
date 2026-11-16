import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { MonetaryDonation } from '../donation/entities/monetary-donation.entity';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

// Importa AuthModule en vez de duplicar el binding de USER_REPOSITORY o el
// registro de TypeOrmModule.forFeature([User]): el perfil opera sobre la
// misma tabla `users` que auth y reusa exactamente su repositorio.
@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([MonetaryDonation])],
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
