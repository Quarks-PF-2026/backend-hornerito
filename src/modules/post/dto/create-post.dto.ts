import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreatePostDto {
  @IsString()
  @IsNotEmpty({ message: 'El título es obligatorio.' })
  @MaxLength(120, { message: 'El título no puede superar los 120 caracteres.' })
  title: string;

  @IsString()
  @IsNotEmpty({ message: 'El contenido no puede estar vacío.' })
  @MaxLength(2000, {
    message: 'El contenido no puede superar los 2000 caracteres.',
  })
  content: string;
}
