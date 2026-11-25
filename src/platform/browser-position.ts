import type { GetPosition, RawPosition } from '../types';

const abortError = { code: 'ABORTED', message: 'Location request was aborted' };

export const browserGetPosition: GetPosition = (options) =>
  new Promise<RawPosition>((resolve, reject) => {
    const geolocation = typeof navigator === 'undefined' ? undefined : navigator.geolocation;

    if (geolocation === undefined) {
      reject({ code: 'GEOLOCATION_UNAVAILABLE', message: 'Geolocation is not available' });
      return;
    }

    if (options.signal?.aborted === true) {
      reject(abortError);
      return;
    }

    const onAbort = (): void => reject(abortError);
    const cleanup = (): void => options.signal?.removeEventListener('abort', onAbort);

    options.signal?.addEventListener('abort', onAbort, { once: true });

    geolocation.getCurrentPosition(
      (position) => {
        cleanup();
        resolve(position as RawPosition);
      },
      (error) => {
        cleanup();
        reject(error);
      },
      {
        enableHighAccuracy: options.enableHighAccuracy,
        timeout: options.timeout,
        maximumAge: options.maximumAge,
      },
    );
  });
