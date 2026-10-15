import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryService } from './cloudinary.service';

describe('CloudinaryService.signUpload', () => {
  beforeAll(() => {
    process.env.CLOUDINARY_CLOUD_NAME = 'demo';
    process.env.CLOUDINARY_API_KEY = 'key';
    process.env.CLOUDINARY_API_SECRET = 'secret';
  });

  it('firma overwrite=false para que el archivo confirmado no se pueda pisar', () => {
    const { params } = new CloudinaryService().signUpload('carpeta/id', [
      'jpg',
      'mp4',
    ]);

    expect(params.overwrite).toBe('false');
    // Lo que el front manda tal cual (FormData lo vuelve string) tiene que
    // producir la misma firma: si overwrite no estuviera firmado, no coincide.
    const sent = {
      public_id: params.public_id,
      timestamp: String(params.timestamp),
      allowed_formats: params.allowed_formats,
      overwrite: String(params.overwrite),
    };
    expect(params.signature).toBe(
      cloudinary.utils.api_sign_request(sent, 'secret'),
    );
    expect(params.signature).not.toBe(
      cloudinary.utils.api_sign_request(
        { ...sent, overwrite: undefined },
        'secret',
      ),
    );
  });
});
