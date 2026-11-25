import type { Result } from '../result';

export interface CacheableRequest {
  readonly signal?: AbortSignal | undefined;
}

export interface CacheResultOptions {
  readonly ttl: number;
  readonly now: () => number;
}

interface Cached<T, E> {
  readonly value: Result<T, E>;
  readonly expiresAt: number;
}

export const cacheResult = <T, E, R extends CacheableRequest>(
  run: (request: R) => Promise<Result<T, E>>,
  { ttl, now }: CacheResultOptions,
): ((request: R) => Promise<Result<T, E>>) => {
  let cached: Cached<T, E> | undefined;
  let pending: Promise<Result<T, E>> | undefined;

  return (request: R): Promise<Result<T, E>> => {
    const current = now();

    if (ttl > 0 && cached !== undefined && current < cached.expiresAt) {
      return Promise.resolve(cached.value);
    }

    if (pending !== undefined) {
      return pending;
    }

    const inFlight = Promise.resolve()
      .then(() => run(request))
      .then((value: Result<T, E>) => {
        if (ttl > 0 && value.ok) {
          cached = { value, expiresAt: now() + ttl };
        }
        return value;
      })
      .finally(() => {
        pending = undefined;
      });

    pending = inFlight;
    return inFlight;
  };
};
