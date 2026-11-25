import { err, ok, type Result } from '../result';
import type { LocationError } from '../types';

export interface HttpRequestOptions {
  readonly fetch: typeof globalThis.fetch;
  readonly url: URL;
  readonly signal?: AbortSignal | undefined;
  readonly timeout: number;
  readonly retries?: number | undefined;
  readonly retryDelay?: ((attempt: number, response: Response) => number) | undefined;
  readonly networkError: LocationError;
  readonly badResponseError: LocationError;
  readonly timeoutError: LocationError;
  readonly httpError: (status: number) => LocationError;
}

const abortError: LocationError = { code: 'ABORTED', message: 'Request was aborted' };

const parseRetryAfter = (value: string | null): number | undefined => {
  if (value === null) {
    return undefined;
  }

  const seconds = Number(value);

  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1_000);
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : Math.max(0, timestamp - Date.now());
};

const defaultRetryDelay = (attempt: number, response: Response): number =>
  parseRetryAfter(response.headers?.get?.('Retry-After') ?? null) ??
  Math.min(1_000, 100 * 2 ** attempt);

const wait = (milliseconds: number, signal: AbortSignal | undefined): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(abortError);
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      reject(abortError);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, milliseconds));
  });

const fetchOnce = async ({
  fetch: fetchImpl,
  url,
  signal,
  timeout,
  timeoutError,
  networkError,
}: HttpRequestOptions): Promise<Response> => {
  if (signal?.aborted === true) {
    throw abortError;
  }

  let timedOut = false;
  let aborted = false;
  let onAbort: (() => void) | undefined;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(timeoutError);
    }, Math.max(0, timeout));
  });
  const abortPromise = signal === undefined
    ? undefined
    : new Promise<never>((_resolve, reject) => {
        onAbort = () => {
          aborted = true;
          reject(abortError);
        };
        signal.addEventListener('abort', onAbort, { once: true });
      });

  const cleanup = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    if (signal !== undefined && onAbort !== undefined) {
      signal.removeEventListener('abort', onAbort);
    }
  };
  const wasAborted = (): boolean => aborted || (signal !== undefined && signal.aborted);

  try {
    return await Promise.race([
      fetchImpl(url.toString(), signal === undefined ? {} : { signal }),
      timeoutPromise,
      ...(abortPromise === undefined ? [] : [abortPromise]),
    ]);
  } catch {
    if (wasAborted()) {
      throw abortError;
    }

    if (timedOut) {
      throw timeoutError;
    }

    throw networkError;
  } finally {
    cleanup();
  }
};

export const requestJson = async (
  options: HttpRequestOptions,
): Promise<Result<unknown, LocationError>> => {
  const retries = options.retries ?? 0;
  const delay = options.retryDelay ?? defaultRetryDelay;

  for (let attempt = 0; ; attempt += 1) {
    let response: Response;

    try {
      response = await fetchOnce(options);
    } catch (error) {
      return err(error as LocationError);
    }

    if (response.ok) {
      try {
        return ok(await response.json());
      } catch {
        return err(options.badResponseError);
      }
    }

    const failure = options.httpError(response.status);
    const retryable = response.status === 429 || response.status >= 500;

    if (!retryable || attempt >= retries) {
      return err(failure);
    }

    try {
      await wait(delay(attempt, response), options.signal);
    } catch {
      return err(abortError);
    }
  }
};
