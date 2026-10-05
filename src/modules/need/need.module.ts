import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { EventModule } from '../event/event.module';
import { Need } from './entities/need.entity';
import { NeedController } from './need.controller';
import { NeedService } from './need.service';

@Module({
  imports: [AuthModule, EventModule, TypeOrmModule.forFeature([Need])],
  controllers: [NeedController],
  providers: [NeedService],
})
export class NeedModule {}
