import { normalizeAddress } from '../core/normalize-address';
import { err, ok, type Result } from '../result';
import type {
  Level,
  LocationError,
  RawAddress,
  ReverseAdapter,
  ReverseResult,
} from '../types';

const DEFAULT_ENDPOINT = 'https://api.bigdatacloud.net/data/reverse-geocode-client';

export interface BigDataCloudConfig {
  readonly fetch?: typeof globalThis.fetch;
  readonly endpoint?: string;
  readonly language?: string;
}

interface PerformParams {
  readonly latitude: number | undefined;
  readonly longitude: number | undefined;
  readonly level: Level;
  readonly signal: AbortSignal | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asString = (value: unknown): string | null | undefined =>
  typeof value === 'string' ? value : undefined;

const toRaw = (body: unknown): RawAddress => {
  const data = isRecord(body) ? body : {};

  return {
    countryCode: asString(data.countryCode),
    countryName: asString(data.countryName),
    region: asString(data.principalSubdivision),
    city: asString(data.city),
    locality: asString(data.locality),
    postcode: asString(data.postcode),
  };
};

const hasContent = (raw: RawAddress): boolean =>
  [raw.countryCode, raw.countryName, raw.region, raw.city, raw.locality, raw.postcode].some(
    (value) => typeof value === 'string' && value.trim() !== '',
  );

export const bigDataCloud = (config: BigDataCloudConfig = {}): ReverseAdapter => {
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  const language = config.language ?? 'en';
  const fetchImpl = config.fetch ?? globalThis.fetch;

  const perform = async ({ latitude, longitude, level, signal }: PerformParams): Promise<Result<ReverseResult, LocationError>> => {
    const url = new URL(endpoint);

    if (latitude !== undefined) {
      url.searchParams.set('latitude', String(latitude));
    }

    if (longitude !== undefined) {
      url.searchParams.set('longitude', String(longitude));
    }

    url.searchParams.set('localityLanguage', language);

    let response: Response;

    try {
      response = await fetchImpl(url.toString(), signal === undefined ? {} : { signal });
    } catch {
      return err({ code: 'PROVIDER_UNAVAILABLE', message: 'Reverse geocoding request failed' });
    }

    if (!response.ok) {
      return response.status === 402
        ? err({
            code: 'PROVIDER_CLIENT_ONLY',
            message: 'BigDataCloud free endpoint must be called from the client',
          })
        : err({
            code: `PROVIDER_HTTP_${response.status}`,
            message: `BigDataCloud returned HTTP ${response.status}`,
          });
    }

    let body: unknown;

    try {
      body = await response.json();
    } catch {
      return err({ code: 'PROVIDER_BAD_RESPONSE', message: 'Reverse geocoding returned invalid JSON' });
    }

    const raw = toRaw(body);

    if (!hasContent(raw)) {
      return err({ code: 'EMPTY_RESPONSE', message: 'No address information was returned' });
    }

    const normalized = normalizeAddress(raw, level);

    if (latitude !== undefined) {
      return ok(normalized);
    }

    const data = isRecord(body) ? body : {};
    const lat = typeof data.latitude === 'number' && Number.isFinite(data.latitude) ? data.latitude : undefined;
    const lon = typeof data.longitude === 'number' && Number.isFinite(data.longitude) ? data.longitude : undefined;

    return ok(lat !== undefined && lon !== undefined ? { ...normalized, position: { lat, lon } } : normalized);
  };

  return {
    id: 'bigdatacloud',
    maxLevel: 'postcode',
    supports: ['country', 'region', 'city', 'postcode'],
    reverse: ({ lat, lon, level, signal }) =>
      perform({ latitude: lat, longitude: lon, level, signal }),
    reverseIp: ({ signal }) => perform({ latitude: undefined, longitude: undefined, level: 'city', signal }),
  };
};
