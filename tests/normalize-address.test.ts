import fc from 'fast-check';
import { normalizeAddress } from '../src/core/normalize-address';
import type { RawAddress } from '../src/types';

describe('normalizeAddress', () => {
  it('normalizes strings and country codes', () => {
    const raw: RawAddress = {
      countryCode: ' us ',
      region: '  New   York ',
      city: '  New York ',
      postcode: ' 10001 ',
      street: '  Main   Street ',
      building: ' 24 ',
    };

    expect(normalizeAddress(raw, 'building')).toEqual({
      actualLevel: 'building',
      fields: {
        countryCode: 'US',
        region: 'New York',
        city: 'New York',
        postcode: '10001',
        street: 'Main Street',
        building: '24',
      },
    });
  });

  it('falls back from city to locality', () => {
    expect(normalizeAddress({ countryCode: 'nl', locality: 'Amsterdam' }, 'city')).toEqual({
      actualLevel: 'city',
      fields: { countryCode: 'NL', city: 'Amsterdam' },
    });
  });

  it('drops empty values and reports the deepest available level', () => {
    const result = normalizeAddress(
      { countryCode: 'de', region: '', city: '   ', postcode: null, street: '' },
      'street',
    );

    expect(result).toEqual({ actualLevel: 'country', fields: { countryCode: 'DE' } });
  });

  it('never returns fields deeper than the requested level', () => {
    const result = normalizeAddress(
      { countryCode: 'fr', city: 'Paris', postcode: '75001', street: 'Rue A', building: '1' },
      'city',
    );

    expect(result).toEqual({
      actualLevel: 'city',
      fields: { countryCode: 'FR', city: 'Paris' },
    });
  });

  it('ignores surrounding whitespace for any field value', () => {
    fc.assert(
      fc.property(fc.string(), fc.constantFrom(' ', '\t', '\n'), (value, space) => {
        const padded = `${space}${space}${value}${space}`;
        const fields = normalizeAddress({ city: padded }, 'city').fields;

        expect(fields.city ?? '').toBe(value.trim().replace(/\s+/gu, ' '));
      }),
    );
  });
});
