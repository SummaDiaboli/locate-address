import { assessConfidence } from '../src/core/confidence';
import type { ReverseResult } from '../src/types';

const base: ReverseResult = {
  actualLevel: 'city',
  fields: { countryCode: 'DE', city: 'Berlin' },
};

const options = (
  overrides: Partial<Parameters<typeof assessConfidence>[0]> = {},
): Parameters<typeof assessConfidence>[0] => ({
  source: 'gps',
  warnings: [],
  reverse: base,
  level: 'city',
  ...overrides,
});

describe('assessConfidence', () => {
  it('keeps clean GPS results high', () => {
    expect(assessConfidence(options())).toEqual({ confidence: 'high', warnings: [] });
  });

  it('keeps existing warnings at medium confidence', () => {
    expect(assessConfidence(options({ warnings: ['coarse fix'] }))).toEqual({
      confidence: 'medium',
      warnings: ['coarse fix'],
    });
  });

  it('downgrades weak provider confidence scores', () => {
    const low = assessConfidence(options({ reverse: { ...base, confidenceScore: 0.3 } }));
    const medium = assessConfidence(options({ reverse: { ...base, confidenceScore: 0.7 } }));

    expect(low.confidence).toBe('low');
    expect(low.warnings).toEqual([expect.stringContaining('confidence is low')]);
    expect(medium.confidence).toBe('medium');
    expect(medium.warnings).toEqual([expect.stringContaining('confidence is moderate')]);
  });

  it('ignores invalid confidence scores', () => {
    for (const confidenceScore of [Number.NaN, -0.1, 1.2]) {
      expect(
        assessConfidence(options({ reverse: { ...base, confidenceScore } })).confidence,
      ).toBe('high');
    }
  });

  it('downgrades matches beyond the level accuracy gate', () => {
    const medium = assessConfidence({
      source: 'gps',
      warnings: [],
      reverse: { ...base, distanceMeters: 6_000 },
      level: 'city',
    });
    const low = assessConfidence({
      source: 'gps',
      warnings: [],
      reverse: { ...base, distanceMeters: 12_000 },
      level: 'city',
    });

    expect(medium.confidence).toBe('medium');
    expect(medium.warnings).toEqual([expect.stringContaining('6000m')]);
    expect(low.confidence).toBe('low');
    expect(low.warnings).toEqual([expect.stringContaining('confidence is low')]);
  });

  it('ignores invalid distances and unlimited levels', () => {
    for (const distanceMeters of [Number.NaN, -1]) {
      expect(
        assessConfidence(options({ reverse: { ...base, distanceMeters } })).confidence,
      ).toBe('high');
    }

    expect(
      assessConfidence({
        source: 'gps',
        warnings: [],
        reverse: { ...base, distanceMeters: 1_000_000 },
        level: 'country',
      }).confidence,
    ).toBe('high');
  });

  it('never raises IP results above low confidence', () => {
    const assessed = assessConfidence({
      source: 'ip',
      warnings: [],
      reverse: { ...base, confidenceScore: 1, distanceMeters: 0 },
      level: 'city',
    });

    expect(assessed.confidence).toBe('low');
    expect(assessed.warnings).toEqual([]);
  });
});
