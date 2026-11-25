import { geoapify } from '../src/adapters/geoapify';
import { LEVELS, type Level } from '../src/types';

const reverseBody = {
  results: [
    {
      country_code: 'de',
      state: 'Berlin',
      city: 'Berlin',
      postcode: '10115',
      street: 'Unter den Linden',
      housenumber: '1',
      result_type: 'building',
      distance: 4,
      rank: { confidence: 0.92 },
      lat: 52.517,
      lon: 13.398,
    },
  ],
};

const ipBody = {
  city: { name: 'Gaithersburg' },
  state: { name: 'Maryland' },
  postal: { code: '20899' },
  country: { iso_code: 'US', name: 'United States' },
  location: { latitude: 39.1402, longitude: -77.2185 },
};

const response = (status: number, body: unknown = reverseBody): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

const createAdapter = (overrides: Partial<Parameters<typeof geoapify>[0]> = {}) =>
  geoapify({ apiKey: 'test-key', ...overrides });

const paramsOf = (fetchMock: ReturnType<typeof vi.fn>): URLSearchParams => {
  const [url] = fetchMock.mock.calls[0] as unknown as [string];
  return new URL(url).searchParams;
};

describe('geoapify adapter', () => {
  it('exposes full-depth capabilities', () => {
    const adapter = createAdapter();

    expect(adapter.id).toBe('geoapify');
    expect(adapter.maxLevel).toBe('building');
    expect(adapter.supports).toEqual(LEVELS);
  });

  it('requires an API key', () => {
    expect(() => geoapify({ apiKey: '   ' })).toThrow('Geoapify requires an API key');
  });

  it('reverse geocodes with normalized fields and metadata', async () => {
    const fetchMock = vi.fn(async () => response(200));
    const signal = new AbortController().signal;
    const adapter = createAdapter({ fetch: fetchMock });

    const result = await adapter.reverse({ lat: 52.5, lon: 13.4, level: 'building', signal });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe('https://api.geoapify.com/v1/geocode/reverse');
    expect(parsed.searchParams.get('lat')).toBe('52.5');
    expect(parsed.searchParams.get('lon')).toBe('13.4');
    expect(parsed.searchParams.get('type')).toBe('building');
    expect(parsed.searchParams.get('format')).toBe('json');
    expect(parsed.searchParams.get('apiKey')).toBe('test-key');
    expect(init.signal).toBe(signal);
    expect(result).toEqual({
      ok: true,
      value: {
        actualLevel: 'building',
        fields: {
          countryCode: 'DE',
          region: 'Berlin',
          city: 'Berlin',
          postcode: '10115',
          street: 'Unter den Linden',
          building: '1',
        },
        distanceMeters: 4,
        confidenceScore: 0.92,
      },
    });
  });

  it('maps each address level to the Geoapify result type', async () => {
    const expected: Readonly<Record<Level, string>> = {
      country: 'country',
      region: 'state',
      city: 'city',
      postcode: 'postcode',
      street: 'street',
      building: 'building',
    };

    for (const level of LEVELS) {
      const fetchMock = vi.fn(async () => response(200));
      const adapter = createAdapter({ fetch: fetchMock });

      await adapter.reverse({ lat: 1, lon: 2, level });

      expect(paramsOf(fetchMock).get('type')).toBe(expected[level]);
    }
  });

  it('passes the configured language', async () => {
    const fetchMock = vi.fn(async () => response(200));
    const adapter = createAdapter({ fetch: fetchMock, language: 'nl' });

    await adapter.reverse({ lat: 1, lon: 2, level: 'city' });

    expect(paramsOf(fetchMock).get('lang')).toBe('nl');
  });

  it('caps the delivered level at the requested level', async () => {
    const fetchMock = vi.fn(async () => response(200));
    const adapter = createAdapter({ fetch: fetchMock });

    const result = await adapter.reverse({ lat: 1, lon: 2, level: 'city' });

    expect(result).toMatchObject({
      ok: true,
      value: { actualLevel: 'city', fields: { countryCode: 'DE', city: 'Berlin' } },
    });
    if (result.ok) {
      expect(result.value.fields.postcode).toBeUndefined();
      expect(result.value.fields.street).toBeUndefined();
      expect(result.value.fields.building).toBeUndefined();
    }
  });

  it('resolves approximate location by IP without coordinates', async () => {
    const fetchMock = vi.fn(async () => response(200, ipBody));
    const signal = new AbortController().signal;
    const adapter = createAdapter({ fetch: fetchMock, language: 'de' });

    const result = await adapter.reverseIp?.({ signal });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe('https://api.geoapify.com/v1/ipinfo');
    expect(parsed.searchParams.get('apiKey')).toBe('test-key');
    expect(parsed.searchParams.get('lang')).toBe('de');
    expect(parsed.searchParams.has('ip')).toBe(false);
    expect(init.signal).toBe(signal);
    expect(result).toEqual({
      ok: true,
      value: {
        actualLevel: 'city',
        fields: { countryCode: 'US', region: 'Maryland', city: 'Gaithersburg' },
        position: { lat: 39.1402, lon: -77.2185 },
      },
    });
  });

  it('omits IP coordinates when they are missing or invalid', async () => {
    const noLocation = createAdapter({ fetch: async () => response(200, { city: { name: 'Paris' } }) });
    const badLocation = createAdapter({
      fetch: async () => response(200, { ...ipBody, location: { latitude: Number.NaN, longitude: 2 } }),
    });

    const first = await noLocation.reverseIp?.({});
    const second = await badLocation.reverseIp?.({});

    expect(first?.ok).toBe(true);
    expect(second?.ok).toBe(true);
    if (first?.ok === true) {
      expect(first.value.position).toBeUndefined();
    }
    if (second?.ok === true) {
      expect(second.value.position).toBeUndefined();
    }
  });

  it('maps invalid keys and rate limits to specific errors', async () => {
    const invalid = createAdapter({ fetch: async () => response(401) });
    const limited = createAdapter({ fetch: async () => response(429) });

    expect(await invalid.reverse({ lat: 1, lon: 1, level: 'city' })).toEqual({
      ok: false,
      error: { code: 'PROVIDER_INVALID_KEY', message: 'Geoapify API key is invalid' },
    });
    expect(await limited.reverse({ lat: 1, lon: 1, level: 'city' })).toEqual({
      ok: false,
      error: { code: 'PROVIDER_RATE_LIMITED', message: 'Geoapify rate limit exceeded' },
    });
  });

  it('maps other HTTP failures to a status-specific error', async () => {
    const adapter = createAdapter({ fetch: async () => response(503) });

    expect(await adapter.reverse({ lat: 1, lon: 1, level: 'city' })).toEqual({
      ok: false,
      error: { code: 'PROVIDER_HTTP_503', message: 'Geoapify returned HTTP 503' },
    });
  });

  it('maps network and JSON failures', async () => {
    const offline = createAdapter({
      fetch: async () => {
        throw new Error('offline');
      },
    });

    expect(await offline.reverse({ lat: 1, lon: 1, level: 'city' })).toEqual({
      ok: false,
      error: { code: 'PROVIDER_UNAVAILABLE', message: 'Reverse geocoding request failed' },
    });

    const broken = createAdapter({
      fetch: async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error('bad json');
          },
        }) as unknown as Response,
    });

    expect(await broken.reverse({ lat: 1, lon: 1, level: 'city' })).toEqual({
      ok: false,
      error: { code: 'PROVIDER_BAD_RESPONSE', message: 'Reverse geocoding returned invalid JSON' },
    });
  });

  it('rejects empty and malformed reverse responses', async () => {
    for (const body of [{ results: [] }, {}, null, { results: [null] }]) {
      const adapter = createAdapter({ fetch: async () => response(200, body) });

      expect(await adapter.reverse({ lat: 1, lon: 1, level: 'city' })).toEqual({
        ok: false,
        error: { code: 'EMPTY_RESPONSE', message: 'No address information was returned' },
      });
    }
  });

  it('maps IP request failures separately', async () => {
    const failed = createAdapter({
      fetch: async () => {
        throw new Error('offline');
      },
    });
    const empty = createAdapter({ fetch: async () => response(200, {}) });

    expect(await failed.reverseIp?.({})).toEqual({
      ok: false,
      error: { code: 'PROVIDER_UNAVAILABLE', message: 'IP lookup request failed' },
    });
    expect(await empty.reverseIp?.({})).toEqual({
      ok: false,
      error: { code: 'EMPTY_RESPONSE', message: 'No location information was returned' },
    });
  });

  it('supports custom endpoints and omits an empty language', async () => {
    const fetchMock = vi.fn(async () => response(200));
    const adapter = createAdapter({
      fetch: fetchMock,
      endpoint: 'https://example.test/reverse',
      language: '  ',
    });

    await adapter.reverse({ lat: 1, lon: 2, level: 'city' });

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe('https://example.test/reverse');
    expect(parsed.searchParams.has('lang')).toBe(false);
  });

  it('omits optional metadata when the provider does not return it', async () => {
    const adapter = createAdapter({
      fetch: async () =>
        response(200, { results: [{ country_code: 'fr', city: 'Paris', result_type: 'unknown' }] }),
    });

    const result = await adapter.reverse({ lat: 1, lon: 2, level: 'city' });

    expect(result).toEqual({
      ok: true,
      value: {
        actualLevel: 'city',
        fields: { countryCode: 'FR', city: 'Paris' },
      },
    });
  });

  it('accepts IP responses with coordinates only', async () => {
    const adapter = createAdapter({
      fetch: async () =>
        response(200, { location: { latitude: 48.85, longitude: 2.35 } }),
    });

    const result = await adapter.reverseIp?.({});

    expect(result).toEqual({
      ok: true,
      value: {
        actualLevel: 'country',
        fields: {},
        position: { lat: 48.85, lon: 2.35 },
      },
    });
  });

  it('reuses recent IP results', async () => {
    let current = 1_000;
    const fetchMock = vi.fn(async () => response(200, ipBody));
    const adapter = createAdapter({
      fetch: fetchMock,
      ipCacheTtl: 100,
      now: () => current,
    });

    await adapter.reverseIp?.({});
    await adapter.reverseIp?.({});
    expect(fetchMock).toHaveBeenCalledOnce();

    current = 1_100;
    await adapter.reverseIp?.({});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('times out slow requests', async () => {
    const adapter = createAdapter({
      fetch: vi.fn(() => new Promise<Response>(() => undefined)),
      timeout: 5,
    });

    expect(await adapter.reverse({ lat: 1, lon: 1, level: 'city' })).toEqual({
      ok: false,
      error: { code: 'PROVIDER_TIMEOUT', message: 'Reverse geocoding request timed out' },
    });
  });

  it('retries rate-limited requests', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(429))
      .mockResolvedValueOnce(response(200));
    const adapter = createAdapter({ fetch: fetchMock, retries: 1, retryDelay: () => 0 });

    expect(await adapter.reverse({ lat: 1, lon: 1, level: 'city' })).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps aborted requests', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const adapter = createAdapter({ fetch: fetchMock });
    const pending = adapter.reverse({ lat: 1, lon: 1, level: 'city', signal: controller.signal });

    controller.abort();

    expect(await pending).toEqual({
      ok: false,
      error: { code: 'ABORTED', message: 'Request was aborted' },
    });
  });

  it('rejects non-object IP responses', async () => {
    const adapter = createAdapter({ fetch: async () => response(200, 'unexpected') });

    expect(await adapter.reverseIp?.({})).toEqual({
      ok: false,
      error: { code: 'EMPTY_RESPONSE', message: 'No location information was returned' },
    });
  });
});
