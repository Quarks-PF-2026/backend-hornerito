import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Organization } from '../organization/entities/organization.entity';
import { PublicNeed } from './entities/public-need.entity';
import { PublicController } from './public.controller';
import { PublicMirrorService } from './public-mirror.service';
import { PublicService } from './public.service';

@Module({
  imports: [TypeOrmModule.forFeature([Organization, PublicNeed])],
  controllers: [PublicController],
  providers: [PublicService, PublicMirrorService],
  exports: [PublicMirrorService],
})
export class PublicModule {}
