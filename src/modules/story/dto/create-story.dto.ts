import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { StoryMediaType } from '../entities/story.entity';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

export class CreateStoryDto {
  /** El que devolvió `POST /stories/signature`; el service verifica la carpeta. */
  @IsString()
  @IsNotEmpty({ message: 'Falta el archivo de la historia.' })
  @MaxLength(200)
  publicId: string;

  @IsEnum(StoryMediaType, { message: 'El tipo tiene que ser image o video.' })
  resourceType: StoryMediaType;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200, { message: 'El texto no puede superar los 200 caracteres.' })
  text?: string;

  @IsOptional()
  @Transform(trim)
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'El enlace tiene que ser una dirección web (http o https).' },
  )
  @MaxLength(500, { message: 'El enlace no puede superar los 500 caracteres.' })
  linkUrl?: string;
}
