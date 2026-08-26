import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CollectionPointController } from './collection-point.controller';
import { CollectionPointService } from './collection-point.service';
import { CollectionPoint } from './entities/collection-point.entity';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([CollectionPoint])],
  controllers: [CollectionPointController],
  providers: [CollectionPointService],
})
export class CollectionPointModule {}
