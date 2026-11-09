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

describe('CloudinaryService.getResource', () => {
  beforeAll(() => {
    process.env.CLOUDINARY_CLOUD_NAME = 'demo';
    process.env.CLOUDINARY_API_KEY = 'key';
    process.env.CLOUDINARY_API_SECRET = 'secret';
  });
  afterEach(() => jest.restoreAllMocks());

  const asset = {
    secure_url: 'https://res.cloudinary.com/x',
    public_id: 'carpeta/id',
    format: 'mp4',
    width: 720,
    height: 1280,
    bytes: 1000,
  };

  it('Dado un video subido, cuando se leen sus datos, entonces pide media_metadata y devuelve la duración', async () => {
    // Sin media_metadata la Admin API omite `duration`: el mock solo la da con el flag.
    const resource = jest
      .spyOn(cloudinary.api, 'resource')
      .mockImplementation(((_id: string, opts: { media_metadata?: boolean }) =>
        Promise.resolve(
          opts.media_metadata ? { ...asset, duration: 10 } : asset,
        )) as never);

    const result = await new CloudinaryService().getResource(
      'carpeta/id',
      'video',
    );

    expect(resource).toHaveBeenCalledWith('carpeta/id', {
      resource_type: 'video',
      media_metadata: true,
    });
    expect(result?.duration).toBe(10);
  });

  it('Dada una imagen, cuando se leen sus datos, entonces no pide media_metadata', async () => {
    const resource = jest
      .spyOn(cloudinary.api, 'resource')
      .mockResolvedValue({ ...asset, format: 'jpg' });

    const result = await new CloudinaryService().getResource(
      'carpeta/id',
      'image',
    );

    expect(resource).toHaveBeenCalledWith('carpeta/id', {
      resource_type: 'image',
    });
    expect(result?.duration).toBeNull();
  });
});
