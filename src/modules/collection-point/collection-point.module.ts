import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CollectionPointController } from './collection-point.controller';
import { CollectionPointService } from './collection-point.service';

@Module({
  imports: [AuthModule],
  controllers: [CollectionPointController],
  providers: [CollectionPointService],
})
export class CollectionPointModule {}
