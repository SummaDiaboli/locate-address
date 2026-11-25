import type { LocateOverrides, Locator } from '../core/locate';
import { isOk, type Result } from '../result';
import type { LocationError, ResolvedLocation } from '../types';

export interface FieldMap {
  readonly countryCode?: string;
  readonly region?: string;
  readonly city?: string;
  readonly postcode?: string;
  readonly street?: string;
  readonly building?: string;
  readonly lat?: string;
  readonly lon?: string;
  readonly accuracy?: string;
}

export type BindStatus =
  | { readonly state: 'idle' }
  | { readonly state: 'locating' }
  | { readonly state: 'done'; readonly result: ResolvedLocation }
  | { readonly state: 'error'; readonly error: LocationError };

export interface BindOptions {
  readonly overwrite?: 'empty-only' | 'always';
  readonly onStatus?: (status: BindStatus) => void;
}

export interface BoundButton {
  readonly trigger: (overrides?: LocateOverrides) => Promise<Result<ResolvedLocation, LocationError>>;
  readonly unbind: () => void;
}

const VALUES: Readonly<Record<keyof FieldMap, (result: ResolvedLocation) => string | undefined>> = {
  countryCode: (result) => result.fields.countryCode,
  region: (result) => result.fields.region,
  city: (result) => result.fields.city,
  postcode: (result) => result.fields.postcode,
  street: (result) => result.fields.street,
  building: (result) => result.fields.building,
  lat: (result) => String(result.lat),
  lon: (result) => String(result.lon),
  accuracy: (result) => String(result.accuracy),
};

const isWritable = (element: Element): boolean =>
  !element.hasAttribute('readonly') &&
  !(element instanceof HTMLInputElement && element.disabled) &&
  !(element instanceof HTMLTextAreaElement && element.disabled) &&
  !(element instanceof HTMLSelectElement && element.disabled);

const setValue = (
  element: Element | null,
  value: string | undefined,
  overwrite: 'empty-only' | 'always',
): void => {
  if (
    element === null ||
    value === undefined ||
    !isWritable(element) ||
    !(
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    )
  ) {
    return;
  }

  if (overwrite === 'empty-only' && element.value !== '') {
    return;
  }

  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
};

export const bind = (
  button: Element,
  locator: Locator,
  fields: FieldMap,
  options: BindOptions = {},
): BoundButton => {
  const overwrite = options.overwrite ?? 'empty-only';
  const doc = button.ownerDocument;
  let pending: Promise<Result<ResolvedLocation, LocationError>> | undefined;

  const emit = (status: BindStatus): void => options.onStatus?.(status);

  emit({ state: 'idle' });

  const fill = (result: ResolvedLocation): void => {
    (Object.keys(fields) as readonly (keyof FieldMap)[]).forEach((key) => {
      const selector = fields[key];

      if (selector === undefined) {
        return;
      }

      setValue(doc.querySelector(selector), VALUES[key](result), overwrite);
    });
  };

  const trigger = (overrides: LocateOverrides = {}): Promise<Result<ResolvedLocation, LocationError>> => {
    if (pending !== undefined) {
      return pending;
    }

    emit({ state: 'locating' });

    const task = Promise.resolve()
      .then(() => locator.locate(overrides))
      .then((outcome) => {
        pending = undefined;

        if (isOk(outcome)) {
          fill(outcome.value);
          emit({ state: 'done', result: outcome.value });
        } else {
          emit({ state: 'error', error: outcome.error });
        }

        return outcome;
      });

    pending = task;
    return task;
  };

  const onClick = (): void => {
    void trigger();
  };

  button.addEventListener('click', onClick);

  return {
    trigger,
    unbind: () => button.removeEventListener('click', onClick),
  };
};
