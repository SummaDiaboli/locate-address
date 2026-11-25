import { bigDataCloud } from '../src/adapters/bigdatacloud';

const payload = {
  countryCode: 'nl',
  countryName: 'Netherlands',
  principalSubdivision: 'North Holland',
  city: 'Amsterdam',
  locality: 'Amsterdam',
  postcode: '1012 JS',
  lookupSource: 'reverseGeocode',
};

const response = (status: number, body: unknown = payload): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

describe('bigDataCloud adapter', () => {
  it('exposes keyless locality-level capabilities', () => {
    const adapter = bigDataCloud();

    expect(adapter.id).toBe('bigdatacloud');
    expect(adapter.maxLevel).toBe('postcode');
    expect(adapter.supports).toEqual(['country', 'region', 'city', 'postcode']);
  });

  it('reverse geocodes with normalized fields and passes the abort signal', async () => {
    const fetchMock = vi.fn(async () => response(200));
    const signal = new AbortController().signal;
    const adapter = bigDataCloud({ fetch: fetchMock });

    const result = await adapter.reverse({ lat: 52.5, lon: 13.4, level: 'city', signal });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('latitude=52.5');
    expect(url).toContain('longitude=13.4');
    expect(url).toContain('localityLanguage=en');
    expect(init.signal).toBe(signal);
    expect(result).toEqual({
      ok: true,
      value: {
        actualLevel: 'city',
        fields: {
          countryCode: 'NL',
          region: 'North Holland',
          city: 'Amsterdam',
        },
      },
    });
  });

  it('resolves locality by IP without coordinates', async () => {
    const fetchMock = vi.fn(async () => response(200));
    const adapter = bigDataCloud({ fetch: fetchMock, language: 'nl' });

    const result = await adapter.reverseIp?.({});

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).not.toContain('latitude');
    expect(url).toContain('localityLanguage=nl');
    expect(result?.ok).toBe(true);
  });

  it('maps a 402 response to a client-side misuse error', async () => {
    const adapter = bigDataCloud({ fetch: async () => response(402) });

    expect(await adapter.reverse({ lat: 1, lon: 1, level: 'city' })).toEqual({
      ok: false,
      error: {
        code: 'PROVIDER_CLIENT_ONLY',
        message: 'BigDataCloud free endpoint must be called from the client',
      },
    });
  });

  it('maps other HTTP failures to a status-specific error', async () => {
    const adapter = bigDataCloud({ fetch: async () => response(503) });

    expect(await adapter.reverse({ lat: 1, lon: 1, level: 'city' })).toEqual({
      ok: false,
      error: { code: 'PROVIDER_HTTP_503', message: 'BigDataCloud returned HTTP 503' },
    });
  });

  it('maps network and JSON failures', async () => {
    const offline = bigDataCloud({ fetch: async () => { throw new Error('offline'); } });

    expect(await offline.reverse({ lat: 1, lon: 1, level: 'city' })).toEqual({
      ok: false,
      error: { code: 'PROVIDER_UNAVAILABLE', message: 'Reverse geocoding request failed' },
    });

    const broken = bigDataCloud({
      fetch: async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }) as unknown as Response,
    });

    expect(await broken.reverse({ lat: 1, lon: 1, level: 'city' })).toEqual({
      ok: false,
      error: { code: 'PROVIDER_BAD_RESPONSE', message: 'Reverse geocoding returned invalid JSON' },
    });
  });

  it('rejects an empty response', async () => {
    const adapter = bigDataCloud({ fetch: async () => response(200, {}) });

    expect(await adapter.reverse({ lat: 1, lon: 1, level: 'city' })).toEqual({
      ok: false,
      error: { code: 'EMPTY_RESPONSE', message: 'No address information was returned' },
    });
  });
});
