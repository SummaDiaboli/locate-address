import { err, ok } from '../src/result';
import { requestJson } from '../src/core/http-request';
import type { LocationError } from '../src/types';

const url = new URL('https://example.test/data');

const response = (status: number, body: unknown = { value: 1 }): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  }) as unknown as Response;

const networkError: LocationError = { code: 'PROVIDER_UNAVAILABLE', message: 'offline' };
const badResponseError: LocationError = { code: 'PROVIDER_BAD_RESPONSE', message: 'bad json' };
const timeoutError: LocationError = { code: 'PROVIDER_TIMEOUT', message: 'timed out' };
const abortError: LocationError = { code: 'ABORTED', message: 'Request was aborted' };

const httpError = (status: number): LocationError => ({
  code: `PROVIDER_HTTP_${status}`,
  message: `HTTP ${status}`,
});

const baseOptions = {
  fetch: vi.fn(async () => response(200)),
  url,
  timeout: 1_000,
  networkError,
  badResponseError,
  timeoutError,
  httpError,
};

describe('requestJson', () => {
  it('returns parsed JSON', async () => {
    const result = await requestJson(baseOptions);

    expect(result).toEqual(ok({ value: 1 }));
  });

  it('maps network and JSON failures', async () => {
    const offline = await requestJson({
      ...baseOptions,
      fetch: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    const broken = await requestJson({
      ...baseOptions,
      fetch: vi.fn(async () =>
        ({
          ...response(200),
          json: async () => {
            throw new Error('bad json');
          },
        }) as unknown as Response,
      ),
    });

    expect(offline).toEqual(err(networkError));
    expect(broken).toEqual(err(badResponseError));
  });

  it('times out when a request never settles', async () => {
    const result = await requestJson({
      ...baseOptions,
      timeout: 5,
      fetch: vi.fn(() => new Promise<Response>(() => undefined)),
    });

    expect(result).toEqual(err(timeoutError));
  });

  it('maps caller aborts', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const pending = requestJson({
      ...baseOptions,
      fetch: fetchMock,
      signal: controller.signal,
    });

    controller.abort();

    expect(await pending).toEqual(err(abortError));
  });

  it('retries rate limits and server errors', async () => {
    for (const status of [429, 503]) {
      const fetchMock = vi.fn().mockResolvedValueOnce(response(status)).mockResolvedValueOnce(response(200));

      const result = await requestJson({
        ...baseOptions,
        fetch: fetchMock,
        retries: 1,
        retryDelay: () => 0,
      });

      expect(result).toEqual(ok({ value: 1 }));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  });

  it('does not retry client errors', async () => {
    const fetchMock = vi.fn(async () => response(400));

    const result = await requestJson({
      ...baseOptions,
      fetch: fetchMock,
      retries: 2,
      retryDelay: () => 0,
    });

    expect(result).toEqual(err({ code: 'PROVIDER_HTTP_400', message: 'HTTP 400' }));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('returns the final error after retries are exhausted', async () => {
    const fetchMock = vi.fn(async () => response(503));

    const result = await requestJson({
      ...baseOptions,
      fetch: fetchMock,
      retries: 1,
      retryDelay: () => 0,
    });

    expect(result).toEqual(err({ code: 'PROVIDER_HTTP_503', message: 'HTTP 503' }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
