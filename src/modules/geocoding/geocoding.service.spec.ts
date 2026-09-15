import { GeocodingService } from './geocoding.service';

/**
 * Lo que importa de este servicio es cómo traduce la respuesta de Nominatim a
 * una sugerencia usable (QK-112): Nominatim no tiene un campo "localidad" y la
 * devuelve con distinto nombre según el tamaño del lugar. Cada test usa una
 * instancia nueva porque el servicio serializa las llamadas dejando un segundo
 * entre cada una: compartir la instancia haría que la suite espere de gusto.
 */
describe('GeocodingService', () => {
  const fetchOriginal = globalThis.fetch;

  /** URL y cantidad de llamadas al proveedor, para los tests que las miran. */
  let urlPedida = '';
  let llamadas = 0;

  /** Responde la búsqueda con los items dados. */
  function responderCon(items: unknown[]): void {
    globalThis.fetch = ((url: string) => {
      urlPedida = url;
      llamadas += 1;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(items),
      });
    }) as unknown as typeof fetch;
  }

  beforeEach(() => {
    urlPedida = '';
    llamadas = 0;
  });

  const item = (address: Record<string, string> | undefined) => ({
    display_name: 'Un lugar, Argentina',
    lat: '-32.4103',
    lon: '-63.24',
    address,
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    jest.restoreAllMocks();
  });

  it('pide los detalles de la dirección, sin los que no hay localidad', async () => {
    responderCon([]);

    await new GeocodingService().search('Villa María');

    expect(urlPedida).toContain('addressdetails=1');
  });

  it('toma la localidad, la provincia y el país de la sugerencia', async () => {
    responderCon([
      item({
        city: 'Villa María',
        state: 'Córdoba',
        country: 'Argentina',
      }),
    ]);

    const [resultado] = await new GeocodingService().search('Villa María');

    expect(resultado).toMatchObject({
      locality: 'Villa María',
      province: 'Córdoba',
      country: 'Argentina',
    });
  });

  it('usa `town` o `village` cuando el lugar es chico y no tiene `city`', async () => {
    responderCon([
      item({ town: 'Oliva', state: 'Córdoba', country: 'Argentina' }),
      item({ village: 'James Craik', state: 'Córdoba', country: 'Argentina' }),
    ]);

    const resultados = await new GeocodingService().search('Oliva');

    expect(resultados.map((r) => r.locality)).toEqual(['Oliva', 'James Craik']);
  });

  it('prefiere la ciudad al barrio cuando vienen los dos', async () => {
    responderCon([
      item({
        suburb: 'Nueva Córdoba',
        city: 'Córdoba',
        state: 'Córdoba',
        country: 'Argentina',
      }),
    ]);

    const [resultado] = await new GeocodingService().search('Nueva Córdoba');

    expect(resultado.locality).toBe('Córdoba');
  });

  it('deja la localidad en null si la sugerencia no trae dirección', async () => {
    responderCon([item(undefined)]);

    const [resultado] = await new GeocodingService().search('Villa María');

    // El resultado sigue siendo válido para el mapa: lo que no se puede es
    // ofrecerlo como localidad. Filtrarlo es decisión de quien lo consume.
    expect(resultado).toMatchObject({
      locality: null,
      province: null,
      country: null,
      lat: -32.4103,
    });
  });

  it('no consulta al proveedor con menos de tres caracteres', async () => {
    responderCon([]);

    expect(await new GeocodingService().search('Vi')).toEqual([]);
    expect(llamadas).toBe(0);
  });

  it('devuelve una lista vacía si el proveedor falla, sin propagar el error', async () => {
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(new Error('Servicio no disponible')) as never;

    await expect(new GeocodingService().search('Villa María')).resolves.toEqual(
      [],
    );
  });
});
