import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CollectionPoint } from '../collection-point/entities/collection-point.entity';
import { Media } from '../media/entities/media.entity';
import { Need } from '../need/entities/need.entity';
import { Organization } from '../organization/entities/organization.entity';
import { Post } from '../post/entities/post.entity';
import { VolunteerType } from '../volunteer-type/entities/volunteer-type.entity';
import { VolunteerOpportunity } from '../volunteering/entities/volunteer-opportunity.entity';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Organization,
      Need,
      Media,
      CollectionPoint,
      Post,
      VolunteerOpportunity,
      VolunteerType,
    ]),
  ],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
