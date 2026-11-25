import { nextTick } from 'vue';
import { useLocateAddress } from '../src/vue';
import { err, ok } from '../src/result';
import type {
  LocationError,
  RawPosition,
  ResolvedLocation,
  ReverseAdapter,
} from '../src/types';

const now = 1_000_000;

const position: RawPosition = {
  coords: { latitude: 48.85, longitude: 2.35, accuracy: 20 },
  timestamp: now,
};

const resolved: ResolvedLocation = {
  lat: 48.85,
  lon: 2.35,
  accuracy: 20,
  timestamp: now,
  source: 'gps',
  requestedLevel: 'city',
  actualLevel: 'city',
  confidence: 'high',
  warnings: [],
  fields: { countryCode: 'FR', city: 'Paris' },
};

const ipResolved: ResolvedLocation = {
  ...resolved,
  source: 'ip',
  confidence: 'low',
  accuracy: 100_000,
};

const adapterWith = (reverse: ReverseAdapter['reverse']): ReverseAdapter => ({
  id: 'vue-test',
  maxLevel: 'building',
  supports: ['country', 'region', 'city', 'postcode', 'street', 'building'],
  reverse,
  reverseIp: async () => ok(ipResolved),
});

const config = (reverse: ReverseAdapter['reverse'] = async () => ok(resolved)) => ({
  adapter: adapterWith(reverse),
  getPosition: async () => position,
  now: () => now,
});

describe('useLocateAddress', () => {
  it('starts idle and exposes reactive refs', async () => {
    const state = useLocateAddress(config());

    expect(state.status.value).toEqual({ state: 'idle' });
    expect(state.result.value).toBeUndefined();
    expect(state.error.value).toBeUndefined();

    await state.locate();

    expect(state.status.value).toEqual({ state: 'done', result: resolved });
    expect(state.result.value).toEqual(resolved);
  });

  it('exposes errors when fallback is disabled', async () => {
    const error: LocationError = { code: 'PROVIDER_UNAVAILABLE', message: 'down' };
    const state = useLocateAddress({
      ...config(async () => err(error)),
      ipFallback: { enabled: false, maxLevel: 'city' },
    });

    const outcome = await state.locate();

    expect(outcome).toEqual(err(error));
    expect(state.status.value).toEqual({ state: 'error', error });
    expect(state.error.value).toEqual(error);
  });

  it('binds a button and keeps refs in sync', async () => {
    document.body.innerHTML = '<input name="city"><button id="locate">Locate</button>';
    const button = document.querySelector<HTMLButtonElement>('#locate');
    const state = useLocateAddress(config());

    expect(button).not.toBeNull();
    const bound = state.bind(button, { city: '[name="city"]' });
    expect(bound).toBeDefined();

    button?.click();
    await vi.waitFor(() =>
      expect(state.status.value).toEqual({ state: 'done', result: resolved }),
    );
    await nextTick();

    expect(state.status.value).toEqual({ state: 'done', result: resolved });
    expect(document.querySelector<HTMLInputElement>('[name="city"]')?.value).toBe('Paris');

    bound?.unbind();
  });

  it('returns undefined when no button is provided', () => {
    const state = useLocateAddress(config());

    expect(state.bind(null, { city: '[name="city"]' })).toBeUndefined();
  });
});
