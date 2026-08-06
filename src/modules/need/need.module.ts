import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PublicModule } from '../public/public.module';
import { NeedController } from './need.controller';
import { NeedService } from './need.service';

@Module({
  imports: [AuthModule, PublicModule],
  controllers: [NeedController],
  providers: [NeedService],
})
export class NeedModule {}
