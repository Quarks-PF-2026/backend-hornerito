import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { StoryView } from './entities/story-view.entity';
import { Story } from './entities/story.entity';
import { StoryController } from './story.controller';
import { StoryService } from './story.service';

@Module({
  imports: [
    AuthModule,
    MediaModule,
    TypeOrmModule.forFeature([Story, StoryView]),
  ],
  controllers: [StoryController],
  providers: [StoryService],
})
export class StoryModule {}
