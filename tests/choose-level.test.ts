import fc from 'fast-check';
import { accuracyLimitFor, chooseLevel } from '../src/core/choose-level';
import { LEVELS } from '../src/types';

const allLevels = LEVELS;

describe('accuracyLimitFor', () => {
  it('allows coarse fixes for country and region', () => {
    expect(accuracyLimitFor('country')).toBe(Number.POSITIVE_INFINITY);
    expect(accuracyLimitFor('region')).toBe(Number.POSITIVE_INFINITY);
  });

  it('tightens limits as depth increases', () => {
    expect(accuracyLimitFor('city')).toBeGreaterThan(accuracyLimitFor('postcode'));
    expect(accuracyLimitFor('postcode')).toBeGreaterThan(accuracyLimitFor('street'));
    expect(accuracyLimitFor('street')).toBeGreaterThan(accuracyLimitFor('building'));
  });
});

describe('chooseLevel', () => {
  it('keeps the requested level when support and accuracy allow it', () => {
    expect(chooseLevel({ requested: 'city', maxLevel: 'building', supports: allLevels, accuracy: 20 })).toEqual({
      level: 'city',
      warnings: [],
    });
  });

  it('clamps to the adapter maximum', () => {
    const result = chooseLevel({
      requested: 'street',
      maxLevel: 'city',
      supports: allLevels,
      accuracy: 5,
    });

    expect(result.level).toBe('city');
    expect(result.warnings).toHaveLength(1);
  });

  it('clamps when accuracy is too coarse', () => {
    const result = chooseLevel({
      requested: 'street',
      maxLevel: 'building',
      supports: allLevels,
      accuracy: 5_000,
    });

    expect(result.level).toBe('city');
    expect(result.warnings.join(' ')).toContain('accuracy');
  });

  it('falls back to country when nothing deeper is supported', () => {
    const result = chooseLevel({
      requested: 'building',
      maxLevel: 'building',
      supports: ['country'],
      accuracy: 1,
    });

    expect(result.level).toBe('country');
    expect(result.warnings).toHaveLength(1);
  });

  it('never returns a level above the adapter maximum', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...allLevels),
        fc.constantFrom(...allLevels),
        fc.double({ min: 0, max: 50_000, noNaN: true }),
        (requested, maxLevel, accuracy) => {
          const supports = allLevels.filter((level) => level !== 'street');
          const result = chooseLevel({ requested, maxLevel, supports, accuracy });

          expect(allLevels.indexOf(result.level)).toBeLessThanOrEqual(allLevels.indexOf(maxLevel));
          expect(supports).toContain(result.level);
        },
      ),
    );
  });
});
