import { useCallback, useMemo, useState } from 'react';
import {
  bind as bindButton,
  type BindOptions,
  type BindStatus,
  type BoundButton,
  type FieldMap,
} from '../dom';
import type { LocateOverrides, Locator } from '../core/locate';
import type { DefaultLocatorConfig } from '../index';
import { createConfiguredLocator, errorFromStatus, resultFromStatus } from '../plugins/shared';
import type { Result } from '../result';
import type { LocationError, ResolvedLocation } from '../types';

export type UseLocateAddressConfig = DefaultLocatorConfig;

export interface UseLocateAddressResult {
  readonly locator: Locator;
  readonly status: BindStatus;
  readonly result: ResolvedLocation | undefined;
  readonly error: LocationError | undefined;
  readonly locate: (overrides?: LocateOverrides) => Promise<Result<ResolvedLocation, LocationError>>;
  readonly bind: (
    button: Element | null,
    fields: FieldMap,
    options?: Omit<BindOptions, 'onStatus'>,
  ) => BoundButton | undefined;
}

export const useLocateAddress = (config: UseLocateAddressConfig = {}): UseLocateAddressResult => {
  const adapter = config.adapter;
  const getPosition = config.getPosition;
  const now = config.now;
  const level = config.level;
  const timeout = config.timeout;
  const maxAge = config.maxAge;
  const fallback = config.ipFallback;
  const fallbackEnabled = fallback?.enabled;
  const fallbackMaxLevel = fallback?.maxLevel;

  const locator = useMemo(
    () =>
      createConfiguredLocator({
        ...(adapter === undefined ? {} : { adapter }),
        ...(getPosition === undefined ? {} : { getPosition }),
        ...(now === undefined ? {} : { now }),
        ...(level === undefined ? {} : { level }),
        ...(timeout === undefined ? {} : { timeout }),
        ...(maxAge === undefined ? {} : { maxAge }),
        ...(fallback === undefined
          ? {}
          : { ipFallback: { enabled: fallbackEnabled ?? true, maxLevel: fallbackMaxLevel ?? 'city' } }),
      }),
    [adapter, getPosition, now, level, timeout, maxAge, fallbackEnabled, fallbackMaxLevel],
  );

  const [status, setStatus] = useState<BindStatus>({ state: 'idle' });

  const locate = useCallback(
    async (overrides: LocateOverrides = {}): Promise<Result<ResolvedLocation, LocationError>> => {
      setStatus({ state: 'locating' });
      const outcome = await locator.locate(overrides);
      setStatus(
        outcome.ok
          ? { state: 'done', result: outcome.value }
          : { state: 'error', error: outcome.error },
      );
      return outcome;
    },
    [locator],
  );

  const bind = useCallback(
    (
      button: Element | null,
      fields: FieldMap,
      options: Omit<BindOptions, 'onStatus'> = {},
    ): BoundButton | undefined =>
      button === null
        ? undefined
        : bindButton(button, locator, fields, {
            ...options,
            onStatus: (next) => setStatus(next),
          }),
    [locator],
  );

  return {
    locator,
    status,
    result: resultFromStatus(status),
    error: errorFromStatus(status),
    locate,
    bind,
  };
};
