import fc from 'fast-check';
import { err, ok } from '../src/result';
import { createLocator } from '../src/core/locate';
import { LEVELS, type RawPosition, type ReverseAdapter, type ReverseResult } from '../src/types';

const now = 1_000_000;
const gps: RawPosition = {
  coords: { latitude: 52.5, longitude: 13.4, accuracy: 20 },
  timestamp: now,
};

const gpsResult: ReverseResult = {
  actualLevel: 'city',
  fields: { countryCode: 'DE', city: 'Berlin' },
};

const ipResult: ReverseResult = {
  actualLevel: 'city',
  fields: { countryCode: 'DE', city: 'Berlin' },
  position: { lat: 52.52, lon: 13.405 },
};

const fakeAdapter = (overrides: Partial<ReverseAdapter> = {}): ReverseAdapter => ({
  id: 'test',
  maxLevel: 'building',
  supports: LEVELS,
  reverse: async () => ok(gpsResult),
  reverseIp: async () => ok(ipResult),
  ...overrides,
});

const setup = (overrides: {
  adapter?: ReverseAdapter;
  position?: () => Promise<RawPosition>;
  level?: 'city' | 'postcode' | 'street';
  ipFallback?: boolean;
} = {}) => {
  const adapter = overrides.adapter ?? fakeAdapter();
  const getPosition = vi.fn(overrides.position ?? (async () => gps));
  const locator = createLocator({
    adapter,
    getPosition,
    now: () => now,
    level: overrides.level ?? 'city',
    ipFallback: { enabled: overrides.ipFallback ?? true, maxLevel: 'city' },
  });

  return { adapter, getPosition, locator };
};

describe('locate', () => {
  it('uses GPS and reverse geocodes at the requested level', async () => {
    const { adapter, locator } = setup();
    const reverse = vi.spyOn(adapter, 'reverse');

    const result = await locator.locate();

    expect(reverse).toHaveBeenCalledWith(expect.objectContaining({ lat: 52.5, lon: 13.4, level: 'city' }));
    expect(result).toMatchObject({
      ok: true,
      value: {
        lat: 52.5,
        lon: 13.4,
        accuracy: 20,
        source: 'gps',
        requestedLevel: 'city',
        actualLevel: 'city',
        confidence: 'high',
        warnings: [],
        fields: { countryCode: 'DE', city: 'Berlin' },
      },
    });
  });

  it('falls back to IP when permission is denied', async () => {
    const { adapter, locator } = setup({
      position: async () => { throw { code: 1 }; },
    });
    const reverse = vi.spyOn(adapter, 'reverse');
    const reverseIp = vi.spyOn(adapter as Required<ReverseAdapter>, 'reverseIp');

    const result = await locator.locate();

    expect(reverse).not.toHaveBeenCalled();
    expect(reverseIp).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      ok: true,
      value: {
        source: 'ip',
        confidence: 'low',
        accuracy: 100_000,
        lat: 52.52,
        lon: 13.405,
        requestedLevel: 'city',
        warnings: expect.arrayContaining([expect.stringContaining('IP')]),
      },
    });
  });

  it('falls back to IP on timeout and unavailable positions', async () => {
    for (const code of [2, 3]) {
      const { locator } = setup({ position: async () => { throw { code }; } });
      const result = await locator.locate();

      expect(result).toMatchObject({ ok: true, value: { source: 'ip' } });
    }
  });

  it('falls back to IP when the GPS fix is invalid', async () => {
    const { locator } = setup({
      position: async () => ({ ...gps, coords: { ...gps.coords, latitude: 200 } }),
    });

    expect(await locator.locate()).toMatchObject({
      ok: true,
      value: { source: 'ip', warnings: expect.arrayContaining([expect.stringContaining('INVALID_COORDINATES')]) },
    });
  });

  it('falls back to IP when reverse geocoding fails', async () => {
    const adapter = fakeAdapter({
      reverse: async () => err({ code: 'PROVIDER_UNAVAILABLE', message: 'down' }),
    });
    const { locator } = setup({ adapter });

    expect(await locator.locate()).toMatchObject({
      ok: true,
      value: { source: 'ip', warnings: expect.arrayContaining([expect.stringContaining('down')]) },
    });
  });

  it('reports a GPS error when IP fallback is disabled', async () => {
    const { locator } = setup({
      position: async () => { throw { code: 1 }; },
      ipFallback: false,
    });

    expect(await locator.locate()).toEqual({
      ok: false,
      error: { code: 'PERMISSION_DENIED', message: 'Location permission was denied' },
    });
  });

  it('does not fall back for aborted requests', async () => {
    const { adapter, locator } = setup({
      position: async () => { throw { code: 'ABORTED', message: 'Location request was aborted' }; },
    });
    const reverseIp = vi.spyOn(adapter as Required<ReverseAdapter>, 'reverseIp');

    expect(await locator.locate()).toEqual({
      ok: false,
      error: { code: 'ABORTED', message: 'Location request was aborted' },
    });
    expect(reverseIp).not.toHaveBeenCalled();
  });

  it('does not fall back when geolocation is unavailable', async () => {
    const { adapter, locator } = setup({
      position: async () => {
        throw { code: 'GEOLOCATION_UNAVAILABLE', message: 'Geolocation is not available' };
      },
    });
    const reverseIp = vi.spyOn(adapter as Required<ReverseAdapter>, 'reverseIp');

    expect(await locator.locate()).toEqual({
      ok: false,
      error: { code: 'GEOLOCATION_UNAVAILABLE', message: 'Geolocation is not available' },
    });
    expect(reverseIp).not.toHaveBeenCalled();
  });

  it('returns the IP error when both paths fail', async () => {
    const adapter = fakeAdapter({
      reverse: async () => err({ code: 'GPS_FAILED', message: 'gps failed' }),
      reverseIp: async () => err({ code: 'IP_FAILED', message: 'ip failed' }),
    });
    const { locator } = setup({ adapter });

    expect(await locator.locate()).toEqual({
      ok: false,
      error: { code: 'IP_FAILED', message: 'ip failed' },
    });
  });

  it('caps IP fallback at the configured city level', async () => {
    const { adapter, locator } = setup({ level: 'street' });
    const reverseIp = vi.spyOn(adapter as Required<ReverseAdapter>, 'reverseIp');

    const result = await locator.locate({
      position: async () => { throw { code: 1 }; },
    });

    expect(reverseIp).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ ok: true, value: { requestedLevel: 'city' } });
  });

  it('marks a clamped GPS result as medium confidence', async () => {
    const adapter = fakeAdapter({ maxLevel: 'city', supports: ['country', 'region', 'city'] });
    const { locator } = setup({ adapter, level: 'street' });

    expect(await locator.locate()).toMatchObject({
      ok: true,
      value: {
        source: 'gps',
        requestedLevel: 'city',
        confidence: 'medium',
        warnings: expect.arrayContaining([expect.stringContaining('unavailable')]),
      },
    });
  });

  it('marks a coarse GPS fix as medium confidence', async () => {
    const { locator } = setup({
      level: 'street',
      position: async () => ({ ...gps, coords: { ...gps.coords, accuracy: 5_000 } }),
    });

    const result = await locator.locate();

    expect(result).toMatchObject({
      ok: true,
      value: { requestedLevel: 'city', confidence: 'medium' },
    });
  });

  it('forwards the abort signal to both geolocation and the adapter', async () => {
    const { adapter, getPosition, locator } = setup();
    const controller = new AbortController();
    const reverse = vi.spyOn(adapter, 'reverse');

    await locator.locate({ signal: controller.signal });

    expect(getPosition).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
    expect(reverse).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
  });

  it('always reports a confidence consistent with its source', () => {
    return fc.assert(
      fc.asyncProperty(fc.boolean(), async (denied) => {
        const { locator } = setup({
          position: denied ? async () => { throw { code: 1 }; } : async () => gps,
        });

        const result = await locator.locate();

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.confidence).toBe(result.value.source === 'ip' ? 'low' : 'high');
        }
        return true;
      }),
    );
  });
});
