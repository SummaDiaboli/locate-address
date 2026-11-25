import { err, ok, type Result } from '../result';
import {
  LEVELS,
  type GetPosition,
  type GetPositionOptions,
  type Level,
  type LocationError,
  type PositionFix,
  type ResolvedLocation,
  type ReverseAdapter,
  type ReverseResult,
} from '../types';
import { chooseLevel, type LevelChoice } from './choose-level';
import { validateFix } from './validate-fix';

const DEFAULT_TIMEOUT = 8_000;
const DEFAULT_MAX_AGE = 60_000;
const IP_ACCURACY = 100_000;

export interface IpFallbackConfig {
  readonly enabled: boolean;
  readonly maxLevel: Level;
}

export interface LocatorConfig {
  readonly adapter: ReverseAdapter;
  readonly getPosition: GetPosition;
  readonly now?: () => number;
  readonly level?: Level;
  readonly timeout?: number;
  readonly maxAge?: number;
  readonly ipFallback?: IpFallbackConfig;
}

export interface LocateOverrides {
  readonly level?: Level;
  readonly signal?: AbortSignal | undefined;
  readonly position?: GetPosition;
}

export interface Locator {
  readonly locate: (overrides?: LocateOverrides) => Promise<Result<ResolvedLocation, LocationError>>;
}

interface ResolveParams {
  readonly reverse: ReverseResult;
  readonly choice: LevelChoice;
  readonly source: 'gps' | 'ip';
  readonly warnings: readonly string[];
  readonly now: () => number;
  readonly fix?: PositionFix | undefined;
}

const rank = (level: Level): number => LEVELS.indexOf(level);

const shallower = (left: Level, right: Level): Level =>
  rank(left) <= rank(right) ? left : right;

const positionError = (error: unknown): LocationError => {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error as { readonly code: unknown };

    if (code === 'ABORTED') {
      return { code: 'ABORTED', message: 'Location request was aborted' };
    }

    if (code === 'GEOLOCATION_UNAVAILABLE') {
      return { code: 'GEOLOCATION_UNAVAILABLE', message: 'Geolocation is not available' };
    }

    if (code === 1) {
      return { code: 'PERMISSION_DENIED', message: 'Location permission was denied' };
    }

    if (code === 2) {
      return { code: 'POSITION_UNAVAILABLE', message: 'Position is unavailable' };
    }

    if (code === 3) {
      return { code: 'TIMEOUT', message: 'Location request timed out' };
    }
  }

  return { code: 'POSITION_FAILED', message: 'Could not obtain a location' };
};

const callReverse = async (
  run: () => Promise<Result<ReverseResult, LocationError>>,
): Promise<Result<ReverseResult, LocationError>> => {
  try {
    return await run();
  } catch {
    return err({ code: 'PROVIDER_UNAVAILABLE', message: 'Reverse geocoding request failed' });
  }
};

const toResolved = ({
  reverse,
  choice,
  source,
  warnings,
  now,
  fix,
}: ResolveParams): Result<ResolvedLocation, LocationError> => {
  let coordinates: { readonly lat: number; readonly lon: number };
  let accuracy: number;
  let timestamp: number;

  if (source === 'gps') {
    if (fix === undefined) {
      return err({ code: 'MISSING_FIX', message: 'A GPS fix is required for GPS results' });
    }

    coordinates = { lat: fix.lat, lon: fix.lon };
    accuracy = fix.accuracy;
    timestamp = fix.timestamp;
  } else {
    if (reverse.position === undefined) {
      return err({ code: 'INVALID_IP_RESPONSE', message: 'IP provider did not return coordinates' });
    }

    coordinates = reverse.position;
    accuracy = IP_ACCURACY;
    timestamp = now();
  }

  const deeperThanDelivered = rank(reverse.actualLevel) < rank(choice.level);
  const finalWarnings = [
    ...warnings,
    ...(deeperThanDelivered ? [`Requested level '${choice.level}' was not available`] : []),
  ];
  const confidence: 'high' | 'medium' | 'low' =
    source === 'ip' ? 'low' : finalWarnings.length === 0 ? 'high' : 'medium';

  return ok({
    lat: coordinates.lat,
    lon: coordinates.lon,
    accuracy,
    timestamp,
    source,
    requestedLevel: choice.level,
    ...reverse,
    confidence,
    warnings: finalWarnings,
  });
};

export const createLocator = (config: LocatorConfig): Locator => {
  const now = config.now ?? (() => Date.now());
  const timeout = config.timeout ?? DEFAULT_TIMEOUT;
  const maxAge = config.maxAge ?? DEFAULT_MAX_AGE;
  const fallback = config.ipFallback ?? { enabled: true, maxLevel: 'city' };

  const locate = async (
    overrides: LocateOverrides = {},
  ): Promise<Result<ResolvedLocation, LocationError>> => {
    const requested = overrides.level ?? config.level ?? 'city';
    const signal = overrides.signal;
    const getPosition = overrides.position ?? config.getPosition;
    const positionOptions: GetPositionOptions = {
      enableHighAccuracy: true,
      timeout,
      maximumAge: maxAge,
      signal,
    };

    let gpsError: LocationError | undefined;
    let gpsWarnings: readonly string[] = [];

    try {
      const raw = await getPosition(positionOptions);
      const validated = validateFix({ now, maxAge })(raw);

      if (!validated.ok) {
        gpsError = validated.error;
        gpsWarnings = [`${validated.error.code}: ${validated.error.message}; using IP fallback`];
      } else {
        const fix = validated.value;
        const choice = chooseLevel({
          requested,
          maxLevel: config.adapter.maxLevel,
          supports: config.adapter.supports,
          accuracy: fix.accuracy,
        });
        const reversed = await callReverse(() =>
          config.adapter.reverse({ lat: fix.lat, lon: fix.lon, level: choice.level, signal }),
        );

        if (reversed.ok) {
          return toResolved({
            fix,
            reverse: reversed.value,
            choice,
            source: 'gps',
            warnings: choice.warnings,
            now,
          });
        }

        gpsError = reversed.error;
        gpsWarnings = [...choice.warnings, `${reversed.error.message}; using IP fallback`];
      }
    } catch (error) {
      gpsError = positionError(error);
      gpsWarnings = [`${gpsError.code}: ${gpsError.message}; using IP fallback`];
    }

    const terminalError =
      gpsError?.code === 'ABORTED' || gpsError?.code === 'GEOLOCATION_UNAVAILABLE';

    if (!fallback.enabled || terminalError || config.adapter.reverseIp === undefined) {
      return err(gpsError ?? { code: 'POSITION_UNAVAILABLE', message: 'No position was available' });
    }

    const ipChoice = chooseLevel({
      requested: shallower(requested, fallback.maxLevel),
      maxLevel: config.adapter.maxLevel,
      supports: config.adapter.supports,
      accuracy: 0,
    });
    const ipReversed = await callReverse(() => config.adapter.reverseIp!({ signal }));

    if (!ipReversed.ok) {
      return ipReversed;
    }

    return toResolved({
      reverse: ipReversed.value,
      choice: ipChoice,
      source: 'ip',
      warnings: [...gpsWarnings, ...ipChoice.warnings, 'IP-based estimate — confirm the location'],
      now,
    });
  };

  return { locate };
};
