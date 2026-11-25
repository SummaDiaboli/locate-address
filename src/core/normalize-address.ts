import { LEVELS, type AddressFields, type Level, type RawAddress, type ReverseResult } from '../types';

const clean = (value: string | null | undefined): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().replace(/\s+/gu, ' ');
  return normalized === '' ? undefined : normalized;
};

const cleanCode = (value: string | null | undefined): string | undefined => {
  const code = clean(value);
  return code?.toUpperCase();
};

const FIELD_FOR_LEVEL: Readonly<Record<Level, keyof AddressFields>> = {
  country: 'countryCode',
  region: 'region',
  city: 'city',
  postcode: 'postcode',
  street: 'street',
  building: 'building',
};

export const normalizeAddress = (raw: RawAddress, requested: Level): ReverseResult => {
  const within = (level: Level): boolean => LEVELS.indexOf(level) <= LEVELS.indexOf(requested);
  const countryCode = cleanCode(raw.countryCode);
  const region = clean(raw.region);
  const city = clean(raw.city) ?? clean(raw.locality);
  const postcode = clean(raw.postcode);
  const street = clean(raw.street);
  const building = clean(raw.building);

  const fields: AddressFields = {
    ...(countryCode !== undefined ? { countryCode } : {}),
    ...(within('region') && region !== undefined ? { region } : {}),
    ...(within('city') && city !== undefined ? { city } : {}),
    ...(within('postcode') && postcode !== undefined ? { postcode } : {}),
    ...(within('street') && street !== undefined ? { street } : {}),
    ...(within('building') && building !== undefined ? { building } : {}),
  };

  const deepest = [...LEVELS]
    .reverse()
    .find((level) => within(level) && fields[FIELD_FOR_LEVEL[level]] !== undefined);

  return { fields, actualLevel: deepest ?? 'country' };
};
