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

  it('rejects empty and non-object responses', async () => {
    for (const body of [{}, null, 'unexpected']) {
      const adapter = bigDataCloud({ fetch: async () => response(200, body) });

      expect(await adapter.reverse({ lat: 1, lon: 1, level: 'city' })).toEqual({
        ok: false,
        error: { code: 'EMPTY_RESPONSE', message: 'No address information was returned' },
      });
    }
  });

  it('reuses recent IP results', async () => {
    let current = 1_000;
    const fetchMock = vi.fn(async () => response(200));
    const adapter = bigDataCloud({
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

  it('times out slow reverse requests', async () => {
    const adapter = bigDataCloud({
      fetch: vi.fn(() => new Promise<Response>(() => undefined)),
      timeout: 5,
    });

    expect(await adapter.reverse({ lat: 1, lon: 1, level: 'city' })).toEqual({
      ok: false,
      error: { code: 'PROVIDER_TIMEOUT', message: 'Reverse geocoding request timed out' },
    });
  });

  it('retries rate-limited reverse requests', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(429))
      .mockResolvedValueOnce(response(200));
    const adapter = bigDataCloud({ fetch: fetchMock, retries: 1, retryDelay: () => 0 });

    expect(await adapter.reverse({ lat: 1, lon: 1, level: 'city' })).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps aborted reverse requests', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const adapter = bigDataCloud({ fetch: fetchMock });
    const pending = adapter.reverse({ lat: 1, lon: 1, level: 'city', signal: controller.signal });

    controller.abort();

    expect(await pending).toEqual({
      ok: false,
      error: { code: 'ABORTED', message: 'Request was aborted' },
    });
  });

  it('omits coordinates from the IP result when they are missing or invalid', async () => {
    const withoutCoordinates = bigDataCloud({ fetch: async () => response(200, payload) });
    const withInvalidCoordinates = bigDataCloud({
      fetch: async () => response(200, { ...payload, latitude: Number.NaN, longitude: 12 }),
    });

    const first = await withoutCoordinates.reverseIp?.({});
    const second = await withInvalidCoordinates.reverseIp?.({});

    expect(first?.ok).toBe(true);
    expect(second?.ok).toBe(true);
    if (first?.ok === true) {
      expect(first.value.position).toBeUndefined();
    }
    if (second?.ok === true) {
      expect(second.value.position).toBeUndefined();
    }
  });
});
