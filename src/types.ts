import type { Result } from './result';

export const LEVELS = ['country', 'region', 'city', 'postcode', 'street', 'building'] as const;

export type Level = (typeof LEVELS)[number];

export interface LocationError {
  readonly code: string;
  readonly message: string;
}

export interface PositionFix {
  readonly lat: number;
  readonly lon: number;
  readonly accuracy: number;
  readonly timestamp: number;
}

export interface RawPosition {
  readonly coords: {
    readonly latitude: number;
    readonly longitude: number;
    readonly accuracy: number;
  };
  readonly timestamp: number;
}

export interface AddressFields {
  readonly countryCode?: string;
  readonly region?: string;
  readonly city?: string;
  readonly postcode?: string;
  readonly street?: string;
  readonly building?: string;
}

export interface ReverseRequest {
  readonly lat: number;
  readonly lon: number;
  readonly level: Level;
  readonly signal?: AbortSignal;
}

export interface RawAddress {
  readonly countryCode?: string | null | undefined;
  readonly countryName?: string | null | undefined;
  readonly region?: string | null | undefined;
  readonly city?: string | null | undefined;
  readonly locality?: string | null | undefined;
  readonly postcode?: string | null | undefined;
  readonly street?: string | null | undefined;
  readonly building?: string | null | undefined;
}

export interface ReverseResult {
  readonly fields: AddressFields;
  readonly actualLevel: Level;
  readonly distanceMeters?: number;
  readonly confidenceScore?: number;
}

export interface ReverseAdapter {
  readonly id: string;
  readonly maxLevel: Level;
  readonly supports: readonly Level[];
  readonly reverse: (request: ReverseRequest) => Promise<Result<ReverseResult, LocationError>>;
  readonly reverseIp?: (request: { readonly signal?: AbortSignal }) => Promise<Result<ReverseResult, LocationError>>;
}

export interface ResolvedLocation extends ReverseResult {
  readonly lat: number;
  readonly lon: number;
  readonly accuracy: number;
  readonly source: 'gps' | 'ip';
  readonly requestedLevel: Level;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly warnings: readonly string[];
}
