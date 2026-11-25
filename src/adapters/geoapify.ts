import { normalizeAddress } from '../core/normalize-address';
import { err, ok, type Result } from '../result';
import {
  LEVELS,
  type Level,
  type LocationError,
  type RawAddress,
  type ReverseAdapter,
  type ReverseRequest,
  type ReverseResult,
} from '../types';

const REVERSE_ENDPOINT = 'https://api.geoapify.com/v1/geocode/reverse';
const IP_ENDPOINT = 'https://api.geoapify.com/v1/ipinfo';

export interface GeoapifyConfig {
  readonly apiKey: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly endpoint?: string;
  readonly ipEndpoint?: string;
  readonly language?: string;
}

interface RequestParams {
  readonly url: URL;
  readonly signal: AbortSignal | undefined;
  readonly operation: 'reverse' | 'ip';
}

const TYPE_FOR_LEVEL: Readonly<Record<Level, string>> = {
  country: 'country',
  region: 'state',
  city: 'city',
  postcode: 'postcode',
  street: 'street',
  building: 'building',
};

const LEVEL_FOR_RESULT_TYPE: Readonly<Record<string, Level>> = {
  building: 'building',
  amenity: 'building',
  street: 'street',
  postcode: 'postcode',
  city: 'city',
  locality: 'city',
  suburb: 'city',
  district: 'city',
  county: 'region',
  state: 'region',
  country: 'country',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asString = (value: unknown): string | null | undefined =>
  typeof value === 'string' ? value : undefined;

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const nestedRecord = (value: unknown, key: string): Record<string, unknown> | undefined => {
  const child = isRecord(value) ? value[key] : undefined;
  return isRecord(child) ? child : undefined;
};

const nestedString = (value: unknown, key: string): string | null | undefined =>
  isRecord(value) ? asString(value[key]) : undefined;

const nestedNumber = (value: unknown, key: string): number | undefined =>
  isRecord(value) ? finite(value[key]) : undefined;

const rank = (level: Level): number => LEVELS.indexOf(level);

const shallowest = (left: Level, right: Level): Level =>
  rank(left) <= rank(right) ? left : right;

const levelForResult = (value: unknown, requested: Level): Level =>
  typeof value === 'string' ? LEVEL_FOR_RESULT_TYPE[value] ?? requested : requested;

const httpError = (status: number, operation: RequestParams['operation']): LocationError => {
  if (status === 401) {
    return { code: 'PROVIDER_INVALID_KEY', message: 'Geoapify API key is invalid' };
  }

  if (status === 429) {
    return { code: 'PROVIDER_RATE_LIMITED', message: 'Geoapify rate limit exceeded' };
  }

  return operation === 'ip'
    ? { code: `PROVIDER_HTTP_${status}`, message: `IP lookup returned HTTP ${status}` }
    : { code: `PROVIDER_HTTP_${status}`, message: `Geoapify returned HTTP ${status}` };
};

const requestJson = async (
  fetchImpl: typeof globalThis.fetch,
  { url, signal, operation }: RequestParams,
): Promise<Result<unknown, LocationError>> => {
  let response: Response;

  try {
    response = await fetchImpl(url.toString(), signal === undefined ? {} : { signal });
  } catch {
    return {
      ok: false,
      error: {
        code: 'PROVIDER_UNAVAILABLE',
        message: operation === 'ip' ? 'IP lookup request failed' : 'Reverse geocoding request failed',
      },
    };
  }

  if (!response.ok) {
    return err(httpError(response.status, operation));
  }

  try {
    return ok(await response.json());
  } catch {
    return err({
      code: 'PROVIDER_BAD_RESPONSE',
      message: operation === 'ip' ? 'IP lookup returned invalid JSON' : 'Reverse geocoding returned invalid JSON',
    });
  }
};

export const geoapify = (config: GeoapifyConfig): ReverseAdapter => {
  const key = config.apiKey.trim();

  if (key === '') {
    throw new Error('Geoapify requires an API key');
  }

  const endpoint = config.endpoint ?? REVERSE_ENDPOINT;
  const ipEndpoint = config.ipEndpoint ?? IP_ENDPOINT;
  const language = config.language?.trim() ?? '';
  const fetchImpl = config.fetch ?? globalThis.fetch;

  const addParams = (url: URL): URL => {
    url.searchParams.set('apiKey', key);

    if (language !== '') {
      url.searchParams.set('lang', language);
    }

    return url;
  };

  const reverse = async ({ lat, lon, level, signal }: ReverseRequest): Promise<Result<ReverseResult, LocationError>> => {
    const url = addParams(new URL(endpoint));
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lon));
    url.searchParams.set('type', TYPE_FOR_LEVEL[level]);
    url.searchParams.set('format', 'json');

    const fetched = await requestJson(fetchImpl, { url, signal, operation: 'reverse' });

    if (!fetched.ok) {
      return fetched;
    }

    const body = fetched.value;
    const result =
      isRecord(body) && Array.isArray(body.results) && isRecord(body.results[0])
        ? body.results[0]
        : undefined;

    if (result === undefined) {
      return err({ code: 'EMPTY_RESPONSE', message: 'No address information was returned' });
    }

    const raw: RawAddress = {
      countryCode: asString(result.country_code),
      region: asString(result.state),
      city: asString(result.city),
      postcode: asString(result.postcode),
      street: asString(result.street),
      building: asString(result.housenumber),
    };
    const normalized = normalizeAddress(raw, level);
    const delivered = levelForResult(result.result_type, level);
    const actualLevel = [level, delivered, normalized.actualLevel].reduce(shallowest);
    const fields = normalizeAddress(raw, actualLevel).fields;
    const distance = finite(result.distance);
    const rankData = isRecord(result.rank) ? result.rank : undefined;
    const confidence = nestedNumber(rankData, 'confidence');

    return ok({
      fields,
      actualLevel,
      ...(distance !== undefined ? { distanceMeters: distance } : {}),
      ...(confidence !== undefined ? { confidenceScore: confidence } : {}),
    });
  };

  const reverseIp = async ({
    signal,
  }: {
    readonly signal?: AbortSignal | undefined;
  }): Promise<Result<ReverseResult, LocationError>> => {
    const fetched = await requestJson(fetchImpl, {
      url: addParams(new URL(ipEndpoint)),
      signal,
      operation: 'ip',
    });

    if (!fetched.ok) {
      return fetched;
    }

    const body = fetched.value;
    const data = isRecord(body) ? body : undefined;
    const raw: RawAddress = {
      countryCode: nestedString(nestedRecord(data, 'country'), 'iso_code'),
      region: nestedString(nestedRecord(data, 'state'), 'name'),
      city: nestedString(nestedRecord(data, 'city'), 'name'),
      postcode: nestedString(nestedRecord(data, 'postal'), 'code'),
    };
    const location = nestedRecord(data, 'location');
    const lat = nestedNumber(location, 'latitude');
    const lon = nestedNumber(location, 'longitude');
    const hasContent = Object.values(raw).some(
      (value) => typeof value === 'string' && value.trim() !== '',
    );

    if (!hasContent && lat === undefined && lon === undefined) {
      return err({ code: 'EMPTY_RESPONSE', message: 'No location information was returned' });
    }

    const normalized = normalizeAddress(raw, 'city');
    const position = lat !== undefined && lon !== undefined ? { lat, lon } : undefined;

    return ok({ ...normalized, ...(position !== undefined ? { position } : {}) });
  };

  return {
    id: 'geoapify',
    maxLevel: 'building',
    supports: LEVELS,
    reverse,
    reverseIp,
  };
};
