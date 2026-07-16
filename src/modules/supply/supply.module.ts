import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SupplyController } from './supply.controller';
import { SupplyService } from './supply.service';

@Module({
  imports: [AuthModule],
  controllers: [SupplyController],
  providers: [SupplyService],
})
export class SupplyModule {}
