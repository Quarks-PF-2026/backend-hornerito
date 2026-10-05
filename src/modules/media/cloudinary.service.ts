import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { UploadApiOptions, v2 as cloudinary } from 'cloudinary';
import type { MediaResourceType } from './media-purposes';

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
  transformation?: { width: number; height: number; crop: string };
}

/**
 * Lo que necesita el navegador para subir directo a Cloudinary: `params` va
 * tal cual en el multipart, junto con `file`.
 */
export interface UploadSignature {
  cloudName: string;
  params: {
    public_id: string;
    timestamp: number;
    allowed_formats: string;
    api_key: string;
    signature: string;
  };
}

/**
 * Wrapper fino sobre el SDK de Cloudinary. El `api_secret` no sale nunca del
 * servidor: las subidas directas del navegador llevan una firma que arma el
 * backend, no el secreto.
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
      transformation: options.transformation
        ? [{ ...options.transformation, quality: 'auto' }]
        : undefined,
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

  /**
   * Firma un único archivo: el `public_id` lo elige el backend y va firmado,
   * igual que los formatos. Cloudinary exige que todo parámetro de la subida
   * esté firmado, así que el navegador no puede cambiar el destino, subir
   * varios archivos con la misma firma ni un formato fuera de la lista; la
   * firma vence sola a la hora.
   */
  signUpload(
    publicId: string,
    allowedFormats: readonly string[],
  ): UploadSignature {
    this.assertConfigured();
    const config = cloudinary.config();
    const toSign = {
      public_id: publicId,
      timestamp: Math.round(Date.now() / 1000),
      allowed_formats: allowedFormats.join(','),
    };
    return {
      cloudName: config.cloud_name!,
      params: {
        ...toSign,
        api_key: config.api_key!,
        signature: cloudinary.utils.api_sign_request(
          toSign,
          config.api_secret!,
        ),
      },
    };
  }

  /** Datos reales del archivo según Cloudinary; null si no existe. */
  async getResource(
    publicId: string,
    resourceType: MediaResourceType,
  ): Promise<UploadedImage | null> {
    this.assertConfigured();
    try {
      const response = (await cloudinary.api.resource(publicId, {
        resource_type: resourceType,
      })) as {
        secure_url: string;
        public_id: string;
        format: string;
        width: number;
        height: number;
        bytes: number;
      };
      return {
        url: response.secure_url,
        publicId: response.public_id,
        format: response.format,
        width: response.width,
        height: response.height,
        bytes: response.bytes,
      };
    } catch (error) {
      if (
        (error as { error?: { http_code?: number } })?.error?.http_code === 404
      ) {
        return null;
      }
      throw error;
    }
  }

  async destroy(
    publicId: string,
    resourceType: MediaResourceType = 'image',
  ): Promise<void> {
    this.assertConfigured();
    await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
    });
  }

  private assertConfigured(): void {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'La subida de imágenes no está configurada en el servidor.',
      );
    }
  }
}
