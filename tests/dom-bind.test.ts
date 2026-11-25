import { bind } from '../src/dom';
import { err, ok } from '../src/result';
import type { Locator } from '../src/core/locate';
import type { LocationError, ResolvedLocation } from '../src/types';

const result: ResolvedLocation = {
  lat: 52.52,
  lon: 13.405,
  accuracy: 20,
  timestamp: 1_000_000,
  source: 'gps',
  requestedLevel: 'city',
  actualLevel: 'city',
  confidence: 'high',
  warnings: [],
  fields: {
    countryCode: 'DE',
    region: 'Berlin',
    city: 'Berlin',
    postcode: '10115',
  },
};

const locatorWith = (value: ResolvedLocation | LocationError): Locator => ({
  locate: vi.fn(async () => ('code' in value ? err(value) : ok(value))),
});

const input = (name: string, value = '', attributes: Record<string, string> = {}): HTMLInputElement => {
  const element = document.createElement('input');
  element.name = name;
  element.value = value;
  Object.entries(attributes).forEach(([key, attrValue]) => element.setAttribute(key, attrValue));
  document.body.append(element);
  return element;
};

describe('bind', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('fills mapped fields and dispatches input and change events', async () => {
    const city = input('city');
    const zip = input('zip');
    const inputEvents: string[] = [];
    const changeEvents: string[] = [];
    city.addEventListener('input', () => inputEvents.push('input'));
    city.addEventListener('change', () => changeEvents.push('change'));

    const button = document.createElement('button');
    const bound = bind(button, locatorWith(result), {
      city: '[name="city"]',
      postcode: '[name="zip"]',
    });

    await bound.trigger();

    expect(city.value).toBe('Berlin');
    expect(zip.value).toBe('10115');
    expect(inputEvents).toEqual(['input']);
    expect(changeEvents).toEqual(['change']);
  });

  it('respects user-entered values by default', async () => {
    const city = input('city', 'Hamburg');
    const button = document.createElement('button');

    await bind(button, locatorWith(result), { city: '[name="city"]' }).trigger();

    expect(city.value).toBe('Hamburg');
  });

  it('overwrites values when configured to', async () => {
    const city = input('city', 'Hamburg');
    const button = document.createElement('button');

    await bind(button, locatorWith(result), { city: '[name="city"]' }, { overwrite: 'always' }).trigger();

    expect(city.value).toBe('Berlin');
  });

  it('skips readonly and disabled fields', async () => {
    const readonly = input('city', '', { readonly: '' });
    const disabled = input('zip', '', { disabled: '' });
    const button = document.createElement('button');

    await bind(button, locatorWith(result), {
      city: '[name="city"]',
      postcode: '[name="zip"]',
    }, { overwrite: 'always' }).trigger();

    expect(readonly.value).toBe('');
    expect(disabled.value).toBe('');
  });

  it('fills coordinates as strings', async () => {
    const lat = input('lat');
    const lon = input('lon');
    const accuracy = input('accuracy');
    const button = document.createElement('button');

    await bind(button, locatorWith(result), {
      lat: '[name="lat"]',
      lon: '[name="lon"]',
      accuracy: '[name="accuracy"]',
    }).trigger();

    expect([lat.value, lon.value, accuracy.value]).toEqual(['52.52', '13.405', '20']);
  });

  it('ignores selectors that match nothing', async () => {
    const button = document.createElement('button');

    await expect(
      bind(button, locatorWith(result), { city: '[name="missing"]' }).trigger(),
    ).resolves.toMatchObject({ ok: true });
  });

  it('emits an idle status when bound', () => {
    const button = document.createElement('button');
    const statuses: string[] = [];

    bind(button, locatorWith(result), { city: '[name="city"]' }, {
      onStatus: (status) => statuses.push(status.state),
    });

    expect(statuses).toEqual(['idle']);
  });

  it('reports status transitions and does not fill on failure', async () => {
    const city = input('city');
    const button = document.createElement('button');
    const statuses: string[] = [];
    const error: LocationError = { code: 'PERMISSION_DENIED', message: 'denied' };

    await bind(button, locatorWith(error), { city: '[name="city"]' }, {
      onStatus: (status) => statuses.push(status.state),
    }).trigger();

    expect(statuses).toEqual(['idle', 'locating', 'error']);
    expect(city.value).toBe('');
  });

  it('coalesces rapid triggers into one lookup', async () => {
    const button = document.createElement('button');
    const locator = locatorWith(result);
    const bound = bind(button, locator, { city: '[name="city"]' });

    await Promise.all([bound.trigger(), bound.trigger()]);

    expect(locator.locate).toHaveBeenCalledOnce();
  });

  it('stops listening after unbind', async () => {
    const button = document.createElement('button');
    const locator = locatorWith(result);
    const bound = bind(button, locator, { city: '[name="city"]' });

    bound.unbind();
    button.click();
    await Promise.resolve();

    expect(locator.locate).not.toHaveBeenCalled();
  });

  it('handles textareas and select fields', async () => {
    const street = document.createElement('textarea');
    street.name = 'street';
    const country = document.createElement('select');
    country.name = 'country';
    country.append(new Option('', ''), new Option('Germany', 'DE'));
    document.body.append(street, country);
    const button = document.createElement('button');

    await bind(button, locatorWith(result), {
      street: '[name="street"]',
      countryCode: '[name="country"]',
    }, { overwrite: 'always' }).trigger();

    expect(street.value).toBe('');
    expect(country.value).toBe('DE');
  });

  it('ignores disabled textareas and selects', async () => {
    const street = document.createElement('textarea');
    street.name = 'street';
    street.disabled = true;
    const country = document.createElement('select');
    country.name = 'country';
    country.disabled = true;
    country.append(new Option('', ''), new Option('Germany', 'DE'));
    document.body.append(street, country);
    const button = document.createElement('button');

    await bind(button, locatorWith(result), {
      street: '[name="street"]',
      countryCode: '[name="country"]',
    }, { overwrite: 'always' }).trigger();

    expect(street.value).toBe('');
    expect(country.value).toBe('');
  });
});
