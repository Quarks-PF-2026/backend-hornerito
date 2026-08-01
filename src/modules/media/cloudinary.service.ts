import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { UploadApiOptions, v2 as cloudinary } from 'cloudinary';

export interface UploadedImage {
  url: string;
  publicId: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
}

export interface UploadOptions {
  folder: string;
  transformation: { width: number; height: number; crop: string };
}

/**
 * Wrapper fino sobre el SDK de Cloudinary. Todo el tráfico de imágenes pasa por
 * el backend para que el `api_secret` no salga nunca del servidor.
 */
@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);
  private readonly configured: boolean;

  constructor() {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    this.configured = Boolean(cloudName && apiKey && apiSecret);

    if (this.configured) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true,
      });
    } else {
      this.logger.warn(
        'Faltan las variables CLOUDINARY_*; la subida de imágenes está deshabilitada.',
      );
    }
  }

  async upload(buffer: Buffer, options: UploadOptions): Promise<UploadedImage> {
    this.assertConfigured();

    const uploadOptions: UploadApiOptions = {
      folder: options.folder,
      resource_type: 'image',
      overwrite: false,
      // Sin public_id fijo: cada subida genera una URL nueva, así el navegador
      // y la CDN no sirven la imagen anterior desde cache.
      transformation: [{ ...options.transformation, quality: 'auto' }],
    };

    const result = await new Promise<UploadedImage>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        uploadOptions,
        (error, response) => {
          if (error || !response) {
            reject(
              error instanceof Error
                ? error
                : new Error('Cloudinary no devolvió una respuesta.'),
            );
            return;
          }
          resolve({
            url: response.secure_url,
            publicId: response.public_id,
            format: response.format,
            width: response.width,
            height: response.height,
            bytes: response.bytes,
          });
        },
      );
      stream.end(buffer);
    });

    return result;
  }

  async destroy(publicId: string): Promise<void> {
    this.assertConfigured();
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
  }

  private assertConfigured(): void {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'La subida de imágenes no está configurada en el servidor.',
      );
    }
  }
}
