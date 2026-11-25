import { err, ok, type Result } from '../result';
import type { LocationError, PositionFix, RawPosition } from '../types';

export interface ValidateFixOptions {
  readonly now: () => number;
  readonly maxAge: number;
}

const reject = (code: string, message: string): Result<PositionFix, LocationError> =>
  err({ code, message });

export const validateFix =
  ({ now, maxAge }: ValidateFixOptions) =>
  (raw: RawPosition): Result<PositionFix, LocationError> => {
    const coords = raw?.coords;

    if (!coords) {
      return reject('COORDS_MISSING', 'No coordinates were provided');
    }

    const { latitude: lat, longitude: lon, accuracy } = coords;
    const { timestamp } = raw;

    if (![lat, lon].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return reject('INVALID_COORDINATES', 'Coordinates are outside valid WGS84 bounds');
    }

    if (!Number.isFinite(accuracy) || accuracy < 0) {
      return reject('INVALID_ACCURACY', 'Accuracy must be a non-negative finite number');
    }

    if (!Number.isFinite(timestamp) || timestamp < 0) {
      return reject('INVALID_TIMESTAMP', 'Position timestamp is invalid');
    }

    const current = now();

    if (timestamp > current) {
      return reject('STALE_FIX', 'Position timestamp is in the future');
    }

    if (current - timestamp > maxAge) {
      return reject('STALE_FIX', 'Position is older than the allowed maximum age');
    }

    return ok({ lat, lon, accuracy, timestamp });
  };
