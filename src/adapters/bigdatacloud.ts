import { requestJson, type HttpRequestOptions } from '../core/http-request';
import { cacheResult } from '../core/ip-cache';
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
const DEFAULT_TIMEOUT = 8_000;
const DEFAULT_RETRIES = 1;
const DEFAULT_IP_CACHE_TTL = 300_000;

export interface BigDataCloudConfig {
  readonly fetch?: typeof globalThis.fetch;
  readonly endpoint?: string;
  readonly language?: string;
  readonly timeout?: number;
  readonly retries?: number;
  readonly retryDelay?: HttpRequestOptions['retryDelay'];
  readonly ipCacheTtl?: number;
  readonly now?: () => number;
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

const httpError = (status: number): LocationError =>
  status === 402
    ? {
        code: 'PROVIDER_CLIENT_ONLY',
        message: 'BigDataCloud free endpoint must be called from the client',
      }
    : {
        code: `PROVIDER_HTTP_${status}`,
        message: `BigDataCloud returned HTTP ${status}`,
      };

export const bigDataCloud = (config: BigDataCloudConfig = {}): ReverseAdapter => {
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  const language = config.language ?? 'en';
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const timeout = config.timeout ?? DEFAULT_TIMEOUT;
  const retries = config.retries ?? DEFAULT_RETRIES;
  const now = config.now ?? (() => Date.now());

  const perform = async ({
    latitude,
    longitude,
    level,
    signal,
  }: PerformParams): Promise<Result<ReverseResult, LocationError>> => {
    const url = new URL(endpoint);

    if (latitude !== undefined) {
      url.searchParams.set('latitude', String(latitude));
    }

    if (longitude !== undefined) {
      url.searchParams.set('longitude', String(longitude));
    }

    url.searchParams.set('localityLanguage', language);

    const fetched = await requestJson({
      fetch: fetchImpl,
      url,
      signal,
      timeout,
      retries,
      retryDelay: config.retryDelay,
      networkError: { code: 'PROVIDER_UNAVAILABLE', message: 'Reverse geocoding request failed' },
      badResponseError: {
        code: 'PROVIDER_BAD_RESPONSE',
        message: 'Reverse geocoding returned invalid JSON',
      },
      timeoutError: { code: 'PROVIDER_TIMEOUT', message: 'Reverse geocoding request timed out' },
      httpError,
    });

    if (!fetched.ok) {
      return fetched;
    }

    const body = fetched.value;
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

  const reverseIp = cacheResult(
    ({ signal }: { readonly signal?: AbortSignal | undefined }) =>
      perform({ latitude: undefined, longitude: undefined, level: 'city', signal }),
    { ttl: config.ipCacheTtl ?? DEFAULT_IP_CACHE_TTL, now },
  );

  return {
    id: 'bigdatacloud',
    maxLevel: 'postcode',
    supports: ['country', 'region', 'city', 'postcode'],
    reverse: ({ lat, lon, level, signal }) =>
      perform({ latitude: lat, longitude: lon, level, signal }),
    reverseIp,
  };
};
