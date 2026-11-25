# locate-address

Framework-agnostic, one-button location autofill for web forms. It resolves the browser's GPS fix to a city by default, with optional postcode/street depth and an automatic city-level IP fallback when GPS is unavailable.

Keyless by default. Adapters are pluggable, so deeper coverage can be added without changing the core.

> Status: early development.

## Install

```sh
npm install locate-address
```

## Quick start

Create a locator and call it from a user action (a button click, not page load):

```ts
import { createDefaultLocator } from 'locate-address';

const locator = createDefaultLocator({ level: 'city' });

document.querySelector('#locate')?.addEventListener('click', async () => {
  const outcome = await locator.locate();

  if (outcome.ok) {
    const { fields, lat, lon, source, confidence, warnings } = outcome.value;
    console.log(fields.city, lat, lon, source, confidence, warnings);
  } else {
    console.error(outcome.error.code, outcome.error.message);
  }
});
```

`createDefaultLocator()` wires browser geolocation and the keyless BigDataCloud adapter. It never asks for permission on page load.

### Autofill form fields

The optional DOM helper fills mapped inputs and emits `input`/`change` events:

```ts
import { bind } from 'locate-address/dom';

const button = document.querySelector<HTMLButtonElement>('#locate');

if (button) {
  bind(button, locator, {
    countryCode: '[name="country"]',
    region: '[name="region"]',
    city: '[name="city"]',
    postcode: '[name="postcode"]',
    street: '[name="street"]',
    lat: '[name="lat"]',
    lon: '[name="lon"]',
    accuracy: '[name="accuracy"]',
  }, {
    overwrite: 'empty-only',
    onStatus: (status) => console.log(status.state),
  });
}
```

By default, existing user input is preserved. Use `overwrite: 'always'` to replace it. Readonly and disabled fields are skipped. Calling `unbind()` removes the click listener.

## Address depth

Levels are ordered shallowest to deepest:

```ts
['country', 'region', 'city', 'postcode', 'street', 'building']
```

The default is `city`. Deeper levels are opt-in:

```ts
const locator = createDefaultLocator({ level: 'street' });
```

A request can be downgraded when the adapter lacks support or the GPS fix is too coarse. Downgrades are reported in `warnings` and lower `confidence` to `medium`.

When an adapter returns `confidenceScore`, scores below `0.5` lower confidence to `low` and scores below `0.8` lower it to `medium`. When it returns `distanceMeters`, a match beyond the selected level's accuracy gate lowers confidence to `medium`, and a match beyond twice that gate lowers it to `low`. IP results always remain `low`.

| Level | Max accuracy |
| --- | --- |
| `country`, `region` | no limit |
| `city` | 5,000 m |
| `postcode` | 1,000 m |
| `street` | 100 m |
| `building` | 30 m |

## IP fallback

When GPS is denied, unavailable, times out, or returns an invalid/stale fix, the locator automatically retries with IP geolocation. The fallback is:

- capped at `city`, even when GPS was asked for `street` or `building`;
- marked `source: 'ip'`, `confidence: 'low'`, and `accuracy: 100_000`;
- annotated with a warning asking the user to confirm the location;
- disabled with `ipFallback: { enabled: false, maxLevel: 'city' }`;
- skipped for aborted requests and missing browser geolocation support.

If both GPS and IP fail, the IP error is returned. `ABORTED` and `GEOLOCATION_UNAVAILABLE` are terminal and do not trigger a lookup.

## Providers

### BigDataCloud (default, keyless)

```ts
import { bigDataCloud, createDefaultLocator } from 'locate-address';

const locator = createDefaultLocator({
  adapter: bigDataCloud({ language: 'en' }),
});
```

- Client-side reverse geocoding and IP lookup with no API key.
- Reliable country/region/city coverage; postcode is strong in the US, UK, and AU and partial elsewhere.
- No street-level data by design.
- Must be called from the browser for the current visitor. Do not proxy it through a server; the free endpoint can return HTTP 402 for server-side or non-visitor usage.
- Subject to BigDataCloud fair use.

Both built-in adapters accept `timeout` (default `8_000` ms), `retries` (default `1`), `retryDelay`, `ipCacheTtl` (default `300_000` ms), and `now` for testing. Retries apply only to HTTP `429` and `5xx` responses and respect `Retry-After` when present. Successful IP lookups are cached per adapter instance; errors are never cached.

### Geoapify (keyed)

```ts
import { createDefaultLocator, geoapify } from 'locate-address';

const locator = createDefaultLocator({
  adapter: geoapify({
    apiKey: 'your-geoapify-key',
    language: 'en',
  }),
  level: 'street',
});
```

- Supports `country | region | city | postcode | street | building`.
- Includes its own IP lookup endpoint, so IP fallback still works.
- Returns optional `distanceMeters` and `confidenceScore` metadata.
- A browser-exposed key is visible to visitors; restrict it by HTTP referrer/origin.

### Custom adapter

```ts
import { ok, type ReverseAdapter } from 'locate-address';

const adapter: ReverseAdapter = {
  id: 'custom',
  maxLevel: 'city',
  supports: ['country', 'region', 'city'],
  reverse: async ({ lat, lon, level, signal }) =>
    ok({ actualLevel: 'city', fields: { countryCode: 'FR', city: 'Paris' } }),
  reverseIp: async ({ signal }) =>
    ok({
      actualLevel: 'city',
      fields: { countryCode: 'FR', city: 'Paris' },
      position: { lat: 48.8566, lon: 2.3522 },
    }),
};
```

`reverseIp` is optional. When it is missing, the locator reports the GPS error instead of falling back. Every adapter method returns `Result<T, E>`; thrown errors are caught and mapped to `PROVIDER_UNAVAILABLE`.

## Result shape

A successful `locate()` returns a `ResolvedLocation`:

```ts
{
  lat: 52.52,
  lon: 13.405,
  accuracy: 20,
  timestamp: 1_000_000,
  source: 'gps' | 'ip',
  requestedLevel: 'city',
  actualLevel: 'city',
  confidence: 'high' | 'medium' | 'low',
  warnings: [],
  fields: { countryCode: 'DE', city: 'Berlin' }
}
```

Failures return `{ ok: false, error: { code, message } }`. Common codes include `PERMISSION_DENIED`, `POSITION_UNAVAILABLE`, `TIMEOUT`, `STALE_FIX`, `INVALID_COORDINATES`, `ABORTED`, `GEOLOCATION_UNAVAILABLE`, `EMPTY_RESPONSE`, `PROVIDER_INVALID_KEY`, and `PROVIDER_RATE_LIMITED`.

## Browser notes

- Geolocation requires a secure context (HTTPS, or localhost in development).
- Users can deny permission or configure approximate location; accuracy gating handles coarse fixes.
- Iframes need an appropriate `Permissions-Policy: geolocation=(self ...)`.
- IP geolocation is approximate and can be wrong with VPNs or proxies.

## Development

```sh
npm test
npm run test:coverage
npm run typecheck
npm run build
```

Coverage thresholds are 90% for statements, branches, functions, and lines.

## License

MIT
