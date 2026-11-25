import { LEVELS, type Level } from '../types';

export interface ChooseLevelOptions {
  readonly requested: Level;
  readonly maxLevel: Level;
  readonly supports: readonly Level[];
  readonly accuracy: number;
}

export interface LevelChoice {
  readonly level: Level;
  readonly warnings: readonly string[];
}

const LIMITS: Readonly<Record<Level, number>> = {
  country: Number.POSITIVE_INFINITY,
  region: Number.POSITIVE_INFINITY,
  city: 5_000,
  postcode: 1_000,
  street: 100,
  building: 30,
};

const rank = (level: Level): number => LEVELS.indexOf(level);

export const accuracyLimitFor = (level: Level): number => LIMITS[level];

export const chooseLevel = ({
  requested,
  maxLevel,
  supports,
  accuracy,
}: ChooseLevelOptions): LevelChoice => {
  const candidates = LEVELS.slice(0, rank(requested) + 1).reverse();
  const eligible = candidates.filter(
    (level) =>
      rank(level) <= rank(maxLevel) &&
      supports.includes(level) &&
      accuracy <= LIMITS[level],
  );
  const fallback = supports.find((level) => rank(level) <= rank(maxLevel)) ?? 'country';
  const level = eligible[0] ?? fallback;
  const warnings: string[] = [];

  if (level !== requested) {
    warnings.push(`Requested level '${requested}' unavailable; using '${level}'`);
  }

  if (accuracy > LIMITS[requested]) {
    warnings.push(`Location accuracy ${Math.round(accuracy)}m is too coarse for '${requested}'`);
  }

  return { level, warnings };
};
