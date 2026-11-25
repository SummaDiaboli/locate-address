import fc from 'fast-check';
import { validateFix } from '../src/core/validate-fix';
import { ok } from '../src/result';
import type { RawPosition } from '../src/types';

const now = 1_000_000;
const defaults = { now: () => now, maxAge: 60_000 };

const position = (
  coords: Partial<RawPosition['coords']> = {},
  patch: Partial<RawPosition> = {},
): RawPosition => ({
  coords: { latitude: 52.5, longitude: 13.4, accuracy: 10, ...coords },
  timestamp: now,
  ...patch,
});

describe('validateFix', () => {
  it('normalizes a valid position', () => {
    expect(validateFix(defaults)(position())).toEqual(
      ok({ lat: 52.5, lon: 13.4, accuracy: 10, timestamp: now }),
    );
  });

  it('rejects missing coordinates', () => {
    const result = validateFix(defaults)({} as RawPosition);

    expect(result).toEqual({ ok: false, error: { code: 'COORDS_MISSING', message: 'No coordinates were provided' } });
  });

  it('rejects non-finite and out-of-range coordinates', () => {
    for (const latitude of [Number.NaN, Number.POSITIVE_INFINITY, 91, -91]) {
      expect(validateFix(defaults)(position({ latitude }))).toEqual({
        ok: false,
        error: { code: 'INVALID_COORDINATES', message: 'Coordinates are outside valid WGS84 bounds' },
      });
    }

    for (const longitude of [Number.NaN, -Number.POSITIVE_INFINITY, 181, -181]) {
      expect(validateFix(defaults)(position({ longitude }))).toEqual({
        ok: false,
        error: { code: 'INVALID_COORDINATES', message: 'Coordinates are outside valid WGS84 bounds' },
      });
    }
  });

  it('rejects invalid accuracy values', () => {
    for (const accuracy of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(validateFix(defaults)(position({ accuracy }))).toEqual({
        ok: false,
        error: { code: 'INVALID_ACCURACY', message: 'Accuracy must be a non-negative finite number' },
      });
    }
  });

  it('rejects invalid timestamps', () => {
    for (const timestamp of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(validateFix(defaults)(position({}, { timestamp }))).toEqual({
        ok: false,
        error: { code: 'INVALID_TIMESTAMP', message: 'Position timestamp is invalid' },
      });
    }
  });

  it('rejects stale and future positions', () => {
    expect(validateFix(defaults)(position({}, { timestamp: now - 60_001 }))).toEqual({
      ok: false,
      error: { code: 'STALE_FIX', message: 'Position is older than the allowed maximum age' },
    });
    expect(validateFix(defaults)(position({}, { timestamp: now + 1 }))).toEqual({
      ok: false,
      error: { code: 'STALE_FIX', message: 'Position timestamp is in the future' },
    });
  });

  it('accepts any valid WGS84 coordinate', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -89, max: 89 }),
        fc.integer({ min: -179, max: 179 }),
        fc.integer({ min: 0, max: 100_000 }),
        (lat, lon, accuracy) => {
          const result = validateFix(defaults)(position({ latitude: lat, longitude: lon, accuracy }));

          expect(result).toEqual(ok({ lat, lon, accuracy, timestamp: now }));
        }),
    );
  });
});
