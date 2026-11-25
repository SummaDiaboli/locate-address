import { bigDataCloud } from './adapters/bigdatacloud';
import { createLocator, type Locator, type LocatorConfig } from './core/locate';
import { browserGetPosition } from './platform/browser-position';
import type { GetPosition, ReverseAdapter } from './types';

export { bigDataCloud, type BigDataCloudConfig } from './adapters/bigdatacloud';
export {
  createLocator,
  type IpFallbackConfig,
  type LocateOverrides,
  type Locator,
  type LocatorConfig,
} from './core/locate';
export { browserGetPosition } from './platform/browser-position';
export { err, ok, type Result } from './result';
export {
  LEVELS,
  type AddressFields,
  type GetPosition,
  type Level,
  type LocationError,
  type RawAddress,
  type RawPosition,
  type ResolvedLocation,
  type ReverseAdapter,
  type ReverseRequest,
  type ReverseResult,
} from './types';

export interface DefaultLocatorConfig extends Omit<LocatorConfig, 'adapter' | 'getPosition'> {
  readonly adapter?: ReverseAdapter;
  readonly getPosition?: GetPosition;
}

export const createDefaultLocator = (config: DefaultLocatorConfig = {}): Locator => {
  const { adapter = bigDataCloud(), getPosition = browserGetPosition, ...rest } = config;

  return createLocator({ ...rest, adapter, getPosition });
};
