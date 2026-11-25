import { ref, shallowRef, type Ref, type ShallowRef } from 'vue';
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
  readonly status: Ref<BindStatus>;
  readonly result: ShallowRef<ResolvedLocation | undefined>;
  readonly error: ShallowRef<LocationError | undefined>;
  readonly locate: (overrides?: LocateOverrides) => Promise<Result<ResolvedLocation, LocationError>>;
  readonly bind: (
    button: Element | null,
    fields: FieldMap,
    options?: Omit<BindOptions, 'onStatus'>,
  ) => BoundButton | undefined;
}

export const useLocateAddress = (config: UseLocateAddressConfig = {}): UseLocateAddressResult => {
  const locator = createConfiguredLocator(config);
  const status = ref<BindStatus>({ state: 'idle' });
  const result = shallowRef<ResolvedLocation | undefined>(undefined);
  const error = shallowRef<LocationError | undefined>(undefined);

  const applyStatus = (next: BindStatus): void => {
    status.value = next;
    result.value = resultFromStatus(next);
    error.value = errorFromStatus(next);
  };

  const locate = async (
    overrides: LocateOverrides = {},
  ): Promise<Result<ResolvedLocation, LocationError>> => {
    applyStatus({ state: 'locating' });
    const outcome = await locator.locate(overrides);
    applyStatus(
      outcome.ok
        ? { state: 'done', result: outcome.value }
        : { state: 'error', error: outcome.error },
    );
    return outcome;
  };

  const bind = (
    button: Element | null,
    fields: FieldMap,
    options: Omit<BindOptions, 'onStatus'> = {},
  ): BoundButton | undefined =>
    button === null
      ? undefined
      : bindButton(button, locator, fields, {
          ...options,
          onStatus: applyStatus,
        });

  return { locator, status, result, error, locate, bind };
};
