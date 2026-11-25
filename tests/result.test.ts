import fc from 'fast-check';
import { err, flatMap, isErr, isOk, map, mapErr, ok, unwrapOr } from '../src/result';

describe('Result', () => {
  it('creates ok and err variants', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
    expect(err('nope')).toEqual({ ok: false, error: 'nope' });
    expect(isOk(ok(1))).toBe(true);
    expect(isOk(err('nope'))).toBe(false);
    expect(isErr(err('nope'))).toBe(true);
    expect(isErr(ok(1))).toBe(false);
  });

  it('maps only the ok value', () => {
    const double = map((value: number) => value * 2);

    expect(double(ok(21))).toEqual(ok(42));
    expect(double(err('nope'))).toEqual(err('nope'));
  });

  it('flat-maps ok values and preserves errors', () => {
    const parse = flatMap((value: string) =>
      Number.isNaN(Number(value)) ? err('not a number') : ok(Number(value)),
    );

    expect(parse(ok('12'))).toEqual(ok(12));
    expect(parse(ok('abc'))).toEqual(err('not a number'));
    expect(parse(err('upstream'))).toEqual(err('upstream'));
  });

  it('maps only the error value', () => {
    const label = mapErr((error: string) => `failed: ${error}`);

    expect(label(err('timeout'))).toEqual(err('failed: timeout'));
    expect(label(ok(1))).toEqual(ok(1));
  });

  it('unwraps with a fallback', () => {
    expect(unwrapOr(0)(ok(7))).toBe(7);
    expect(unwrapOr(0)(err('nope'))).toBe(0);
  });

  it('never overrides an ok value with the fallback', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (value, fallback) => {
        expect(unwrapOr(fallback)(ok(value))).toBe(value);
      }),
    );
  });
});
