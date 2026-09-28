import { Injectable, Logger } from '@nestjs/common';

export interface GeocodeResult {
  label: string;
  lat: number;
  lon: number;
  /** Localidad normalizada de la sugerencia (QK-112). */
  locality: string | null;
  province: string | null;
  country: string | null;
}

interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  hamlet?: string;
  suburb?: string;
  state?: string;
  country?: string;
}

interface NominatimItem {
  display_name?: string;
  lat?: string;
  lon?: string;
  address?: NominatimAddress;
}

/**
 * Nominatim no tiene un campo "localidad": según el tamaño del lugar lo
 * devuelve como `city`, `town`, `village` o `municipality`. El orden va de
 * mayor a menor para que una sugerencia dentro de una ciudad grande no
 * termine identificada por su barrio. `suburb` queda último, como red de
 * seguridad: mejor un barrio que nada.
 */
const LOCALITY_KEYS = [
  'city',
  'town',
  'village',
  'municipality',
  'hamlet',
  'suburb',
] as const;

function localityOf(address: NominatimAddress | undefined): string | null {
  if (!address) {
    return null;
  }
  for (const key of LOCALITY_KEYS) {
    const value = address[key]?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const MIN_INTERVAL_MS = 1000;
const TIMEOUT_MS = 5000;

/**
 * Proxy de Nominatim. Se consume desde el backend porque el servicio exige un
 * `User-Agent` propio y limita a 1 request por segundo. Ante cualquier error
 * devuelve una lista vacía: el geocoder es una ayuda, nunca bloquea el guardado.
 */
@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private readonly userAgent =
    process.env.NOMINATIM_USER_AGENT ??
    'hornerito/1.0 (odontologiasoftia@gmail.com)';
  private queue: Promise<unknown> = Promise.resolve();

  async search(query: string): Promise<GeocodeResult[]> {
    const q = query.trim();
    if (q.length < 3) {
      return [];
    }
    return this.enqueue(() => this.fetchFromNominatim(q));
  }

  /** Serializa las llamadas dejando al menos 1 segundo entre requests. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result
      .catch(() => undefined)
      .then(
        () => new Promise((resolve) => setTimeout(resolve, MIN_INTERVAL_MS)),
      );
    return result;
  }

  private async fetchFromNominatim(q: string): Promise<GeocodeResult[]> {
    const url =
      `${NOMINATIM_URL}?format=json&addressdetails=1&limit=5&countrycodes=ar` +
      `&q=${encodeURIComponent(q)}`;
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': this.userAgent, 'Accept-Language': 'es' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`Nominatim respondió ${response.status}`);
        return [];
      }
      const items = (await response.json()) as NominatimItem[];
      return items
        .filter((item) => item.display_name && item.lat && item.lon)
        .map((item) => ({
          label: item.display_name!,
          lat: Number(item.lat),
          lon: Number(item.lon),
          locality: localityOf(item.address),
          province: item.address?.state?.trim() || null,
          country: item.address?.country?.trim() || null,
        }));
    } catch (error) {
      this.logger.warn(`Falló la búsqueda de dirección: ${String(error)}`);
      return [];
    }
  }
}
