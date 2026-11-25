import { bigDataCloud, createDefaultLocator, createLocator, LEVELS } from '../src/index';
import type { GetPosition, RawPosition } from '../src/types';

const raw: RawPosition = {
  coords: { latitude: 52.52, longitude: 13.405, accuracy: 25 },
  timestamp: 1_000_000,
};

const payload = {
  countryCode: 'de',
  principalSubdivision: 'Berlin',
  city: 'Berlin',
  postcode: '10115',
  latitude: 52.52,
  longitude: 13.405,
};

describe('public API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('exposes the core building blocks', () => {
    expect(typeof createLocator).toBe('function');
    expect(typeof createDefaultLocator).toBe('function');
    expect(bigDataCloud().id).toBe('bigdatacloud');
    expect(LEVELS).toContain('city');
  });

  it('wires browser geolocation and BigDataCloud by default', async () => {
    const getCurrentPosition = vi.fn((success: (position: RawPosition) => void) => success(raw));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    const fetchMock = vi.fn(async () =>
      ({ ok: true, status: 200, json: async () => payload }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await createDefaultLocator({ level: 'city', now: () => 1_000_000 }).locate();

    expect(getCurrentPosition).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      ok: true,
      value: {
        source: 'gps',
        lat: 52.52,
        lon: 13.405,
        fields: { countryCode: 'DE', region: 'Berlin', city: 'Berlin' },
      },
    });
  });

  it('accepts injected dependencies', async () => {
    const getPosition: GetPosition = async () => raw;
    const cityResult = { ok: true, value: { actualLevel: 'city', fields: { city: 'Berlin' } } } as const;
    const adapter = {
      ...bigDataCloud(),
      reverse: async () => cityResult,
      reverseIp: async () => ({ ...cityResult, value: { ...cityResult.value, position: { lat: 52.52, lon: 13.405 } } }),
    };

    const result = await createDefaultLocator({ adapter, getPosition, now: () => 1_000_000 }).locate();

    expect(result).toMatchObject({ ok: true, value: { source: 'gps', fields: { city: 'Berlin' } } });
  });
});
