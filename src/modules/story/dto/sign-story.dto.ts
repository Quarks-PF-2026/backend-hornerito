import { IsEnum } from 'class-validator';
import { StoryMediaType } from '../entities/story.entity';

export class SignStoryDto {
  @IsEnum(StoryMediaType, { message: 'El tipo tiene que ser image o video.' })
  resourceType: StoryMediaType;
}
