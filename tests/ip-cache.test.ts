import { err, ok } from '../src/result';
import { cacheResult } from '../src/core/ip-cache';
import type { LocationError } from '../src/types';

const error: LocationError = { code: 'PROVIDER_UNAVAILABLE', message: 'offline' };

describe('cacheResult', () => {
  it('returns a successful result until its TTL expires', async () => {
    let current = 1_000;
    const run = vi.fn(async () => ok({ city: 'Paris' }));
    const cached = cacheResult(run, { ttl: 100, now: () => current });

    expect(await cached({})).toEqual(ok({ city: 'Paris' }));
    current = 1_099;
    expect(await cached({})).toEqual(ok({ city: 'Paris' }));
    expect(run).toHaveBeenCalledOnce();

    current = 1_100;
    expect(await cached({})).toEqual(ok({ city: 'Paris' }));
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not cache failed results', async () => {
    const run = vi.fn(async () => err(error));
    const cached = cacheResult(run, { ttl: 100, now: () => 1_000 });

    expect(await cached({})).toEqual(err(error));
    expect(await cached({})).toEqual(err(error));
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('shares an in-flight request', async () => {
    let resolve!: (value: ReturnType<typeof ok<string>>) => void;
    const run = vi.fn(
      () =>
        new Promise<ReturnType<typeof ok<string>>>((resolvePromise) => {
          resolve = resolvePromise;
        }),
    );
    const cached = cacheResult(run, { ttl: 100, now: () => 1_000 });

    const first = cached({});
    const second = cached({});
    await Promise.resolve();

    resolve(ok('Berlin'));
    expect(await first).toEqual(ok('Berlin'));
    expect(await second).toEqual(ok('Berlin'));
    expect(run).toHaveBeenCalledOnce();
  });
});
