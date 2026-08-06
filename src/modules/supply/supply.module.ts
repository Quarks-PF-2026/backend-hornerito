import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PublicModule } from '../public/public.module';
import { SupplyController } from './supply.controller';
import { SupplyService } from './supply.service';

@Module({
  imports: [AuthModule, PublicModule],
  controllers: [SupplyController],
  providers: [SupplyService],
})
export class SupplyModule {}
