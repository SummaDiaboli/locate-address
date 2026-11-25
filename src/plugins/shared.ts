import type { BindStatus } from '../dom';
import { createDefaultLocator, type DefaultLocatorConfig } from '../index';
import type { Locator } from '../core/locate';
import type { LocationError, ResolvedLocation } from '../types';

export const createConfiguredLocator = (config: DefaultLocatorConfig): Locator => {
  const fallback = config.ipFallback;
  const fallbackEnabled = fallback?.enabled;
  const fallbackMaxLevel = fallback?.maxLevel;

  return createDefaultLocator({
    ...(config.adapter === undefined ? {} : { adapter: config.adapter }),
    ...(config.getPosition === undefined ? {} : { getPosition: config.getPosition }),
    ...(config.now === undefined ? {} : { now: config.now }),
    ...(config.level === undefined ? {} : { level: config.level }),
    ...(config.timeout === undefined ? {} : { timeout: config.timeout }),
    ...(config.maxAge === undefined ? {} : { maxAge: config.maxAge }),
    ...(fallback === undefined
      ? {}
      : { ipFallback: { enabled: fallbackEnabled ?? true, maxLevel: fallbackMaxLevel ?? 'city' } }),
  });
};

export const resultFromStatus = (status: BindStatus): ResolvedLocation | undefined =>
  status.state === 'done' ? status.result : undefined;

export const errorFromStatus = (status: BindStatus): LocationError | undefined =>
  status.state === 'error' ? status.error : undefined;
