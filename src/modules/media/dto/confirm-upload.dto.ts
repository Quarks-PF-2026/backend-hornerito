import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import type { MediaResourceType } from '../media-purposes';

/**
 * Solo identifica el archivo ya subido. Tamaño, formato y dimensiones no se
 * aceptan del cliente: el service los lee de Cloudinary.
 */
export class ConfirmUploadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  publicId: string;

  @IsIn(['image', 'video'])
  resourceType: MediaResourceType;
}
