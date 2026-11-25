import { act, renderHook, waitFor } from '@testing-library/react';
import { useLocateAddress } from '../src/react';
import { err, ok } from '../src/result';
import type {
  LocationError,
  RawPosition,
  ResolvedLocation,
  ReverseAdapter,
} from '../src/types';

const now = 1_000_000;

const position: RawPosition = {
  coords: { latitude: 52.52, longitude: 13.405, accuracy: 20 },
  timestamp: now,
};

const resolved: ResolvedLocation = {
  lat: 52.52,
  lon: 13.405,
  accuracy: 20,
  timestamp: now,
  source: 'gps',
  requestedLevel: 'city',
  actualLevel: 'city',
  confidence: 'high',
  warnings: [],
  fields: { countryCode: 'DE', city: 'Berlin' },
};

const ipResolved: ResolvedLocation = {
  ...resolved,
  source: 'ip',
  confidence: 'low',
  accuracy: 100_000,
};

const adapterWith = (reverse: ReverseAdapter['reverse']): ReverseAdapter => ({
  id: 'react-test',
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
  it('starts idle and exposes a resolved location', async () => {
    const { result } = renderHook(() => useLocateAddress(config()));

    expect(result.current.status).toEqual({ state: 'idle' });
    expect(result.current.result).toBeUndefined();
    expect(result.current.error).toBeUndefined();

    await act(async () => {
      await result.current.locate();
    });

    await waitFor(() => expect(result.current.status).toEqual({ state: 'done', result: resolved }));
    expect(result.current.result).toEqual(resolved);
  });

  it('exposes errors when fallback is disabled', async () => {
    const error: LocationError = { code: 'PROVIDER_UNAVAILABLE', message: 'down' };
    const { result } = renderHook(() =>
      useLocateAddress({
        ...config(async () => err(error)),
        ipFallback: { enabled: false, maxLevel: 'city' },
      }),
    );

    await act(async () => {
      const outcome = await result.current.locate();
      expect(outcome).toEqual(err(error));
    });

    await waitFor(() => expect(result.current.status).toEqual({ state: 'error', error }));
    expect(result.current.error).toEqual(error);
  });

  it('binds a button and keeps the hook state in sync', async () => {
    document.body.innerHTML = '<input name="city"><button id="locate">Locate</button>';
    const button = document.querySelector<HTMLButtonElement>('#locate');
    const { result, unmount } = renderHook(() => useLocateAddress(config()));

    expect(button).not.toBeNull();
    const bound = result.current.bind(button, { city: '[name="city"]' });
    expect(bound).toBeDefined();

    await act(async () => {
      button?.click();
    });

    await waitFor(() =>
      expect(result.current.status).toEqual({ state: 'done', result: resolved }),
    );
    expect(document.querySelector<HTMLInputElement>('[name="city"]')?.value).toBe('Berlin');

    bound?.unbind();
    unmount();
  });

  it('returns undefined when no button is provided', () => {
    const { result } = renderHook(() => useLocateAddress(config()));

    expect(result.current.bind(null, { city: '[name="city"]' })).toBeUndefined();
  });
});
