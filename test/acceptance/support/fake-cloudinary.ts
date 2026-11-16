/**
 * Doble de `CloudinaryService` para la aceptación.
 *
 * Reemplaza **solo la frontera externa**: la API de Cloudinary, que en tests
 * no está configurada y que de todas formas no queremos golpear (cuesta cuota
 * y vuelve no determinista la suite). Todo lo demás — controllers, guards,
 * validación de formato/tamaño/duración, persistencia — corre real.
 *
 * Simula el flujo de subida directa: el navegador sube a Cloudinary con la
 * firma que dio el backend, y después el backend lee los metadatos reales del
 * archivo con `getResource`. Acá "subir" es `registrar`: el step declara qué
 * archivo quedó en Cloudinary bajo ese `publicId`, y el backend lo lee como
 * si viniera de la API.
 */
import type {
  UploadSignature,
  UploadedImage,
} from '../../../src/modules/media/cloudinary.service';
import type { MediaResourceType } from '../../../src/modules/media/media-purposes';

/** Lo que Cloudinary informa de un recurso; los videos traen además `duration`. */
export type RecursoEnCloudinary = UploadedImage & { duration?: number };

export class FakeCloudinary {
  private readonly recursos = new Map<string, RecursoEnCloudinary>();
  readonly destruidos: Array<{ publicId: string; resourceType: string }> = [];

  /** El "navegador" terminó de subir este archivo a Cloudinary. */
  registrar(
    publicId: string,
    resourceType: MediaResourceType,
    datos: Omit<RecursoEnCloudinary, 'publicId'>,
  ): void {
    this.recursos.set(`${resourceType}:${publicId}`, { ...datos, publicId });
  }

  signUpload(
    publicId: string,
    allowedFormats: readonly string[],
  ): UploadSignature {
    return {
      cloudName: 'hornerito-test',
      params: {
        public_id: publicId,
        timestamp: Math.round(Date.now() / 1000),
        allowed_formats: allowedFormats.join(','),
        overwrite: 'false',
        api_key: 'fake-api-key',
        signature: 'fake-signature',
      },
    };
  }

  /** Igual que Cloudinary: el recurso se busca por tipo; si no existe, null. */
  getResource(
    publicId: string,
    resourceType: MediaResourceType,
  ): Promise<RecursoEnCloudinary | null> {
    return Promise.resolve(
      this.recursos.get(`${resourceType}:${publicId}`) ?? null,
    );
  }

  destroy(
    publicId: string,
    resourceType: MediaResourceType = 'image',
  ): Promise<void> {
    this.destruidos.push({ publicId, resourceType });
    return Promise.resolve();
  }

  upload(): Promise<UploadedImage> {
    return Promise.reject(
      new Error(
        'FakeCloudinary.upload no está simulado: ningún escenario sube por el backend.',
      ),
    );
  }
}
