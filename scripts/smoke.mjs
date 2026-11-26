import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const live = process.argv.includes('--live');
const keyArg = process.argv.find((arg) => arg.startsWith('--geoapify-key='));
const geoapifyKey = keyArg === undefined
  ? process.env.GEOAPIFY_KEY ?? ''
  : keyArg.slice('--geoapify-key='.length);

const configFile = fileURLToPath(new URL('../examples/basic/vite.config.ts', import.meta.url));
const position = { latitude: 52.52, longitude: 13.405 };
const headers = { 'Access-Control-Allow-Origin': '*' };

const reverseBody = {
  countryCode: 'de',
  principalSubdivision: 'Berlin',
  city: 'Berlin',
  locality: 'Berlin',
  postcode: '10115',
  latitude: position.latitude,
  longitude: position.longitude,
};

const ipBody = {
  countryCode: 'de',
  principalSubdivision: 'Berlin',
  city: 'Berlin',
  locality: 'Berlin',
  postcode: '10115',
  latitude: position.latitude,
  longitude: position.longitude,
};

const startServer = async () => {
  const server = await createServer({
    configFile,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  await server.listen();

  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  assert.ok(port > 0, 'Vite did not expose a port');

  return { server, url: `http://127.0.0.1:${port}/` };
};

const readStatus = async (page) => (await page.locator('#status').textContent()) ?? '';

const waitForTerminalStatus = (page) =>
  page.waitForFunction(
    () => {
      const text = document.querySelector('#status')?.textContent ?? '';
      return text.startsWith('Found ') || text.includes(':');
    },
    undefined,
    { timeout: 20_000 },
  );

const addGeoapifyKey = async (context) => {
  if (geoapifyKey !== '') {
    await context.addInitScript(
      (key) => {
        globalThis.__LOCATE_ADDRESS_GEOAPIFY_KEY__ = key;
      },
      geoapifyKey,
    );
  }
};

const mockProvider = async (context, requests) => {
  await context.route(
    'https://api.bigdatacloud.net/data/reverse-geocode-client**',
    async (route) => {
      const url = new URL(route.request().url());
      const isReverse = url.searchParams.has('latitude');
      requests.push(isReverse ? 'reverse' : 'ip');

      await route.fulfill({
        status: 200,
        headers,
        contentType: 'application/json',
        body: JSON.stringify(isReverse ? reverseBody : ipBody),
      });
    },
  );
};

const assertField = async (page, name, expected) => {
  const actual = await page.locator(`[name="${name}"]`).inputValue();
  assert.equal(actual, expected, `${name} field`);
};

const assertCoordinates = async (page) => {
  const lat = await page.locator('[name="lat"]').inputValue();
  const lon = await page.locator('[name="lon"]').inputValue();
  assert.notEqual(lat.trim(), '', 'latitude field');
  assert.notEqual(lon.trim(), '', 'longitude field');
};

const runGpsScenario = async (browser, url) => {
  const context = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: position,
  });
  const requests = [];
  await addGeoapifyKey(context);

  if (!live) {
    await mockProvider(context, requests);
  }

  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('#status').waitFor();

  assert.equal(await readStatus(page), 'idle', 'status before click');
  assert.equal(requests.length, 0, 'provider requests on page load');

  await page.locator('#locate').click();
  await waitForTerminalStatus(page);
  const status = await readStatus(page);

  assert.match(status, /^Found .+ via gps \(confidence: (high|medium|low)\)/, status);

  if (live) {
    await assertCoordinates(page);
  } else {
    assert.equal(requests.length, 1, 'provider requests after click');
    assert.deepEqual(requests, ['reverse']);
    await assertField(page, 'countryCode', 'DE');
    await assertField(page, 'city', 'Berlin');
    await assertField(page, 'lat', String(position.latitude));
    await assertField(page, 'lon', String(position.longitude));
  }

  console.log(`GPS scenario: ${status.split('\n')[0]}`);
  await context.close();
};

const runIpScenario = async (browser, url) => {
  const context = await browser.newContext();
  const requests = [];
  await addGeoapifyKey(context);

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (_success, error) => {
          error?.({ code: 1, message: 'User denied Geolocation' });
        },
      },
    });
  });

  if (!live) {
    await mockProvider(context, requests);
  }

  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('#status').waitFor();

  assert.equal(requests.length, 0, 'provider requests on page load');

  await page.locator('#locate').click();
  await waitForTerminalStatus(page);
  const status = await readStatus(page);

  assert.match(status, /^Found .+ via ip \(confidence: low\)/, status);
  assert.match(status, /IP-based estimate — confirm the location/, status);

  if (live) {
    await assertCoordinates(page);
  } else {
    assert.deepEqual(requests, ['ip']);
    await assertField(page, 'countryCode', 'DE');
    await assertField(page, 'city', 'Berlin');
    await assertField(page, 'lat', String(position.latitude));
    await assertField(page, 'lon', String(position.longitude));
  }

  console.log(`IP fallback scenario: ${status.split('\n')[0]}`);
  await context.close();
};

const main = async () => {
  const { server, url } = await startServer();
  const browser = await chromium.launch({ headless: true });

  try {
    await runGpsScenario(browser, url);
    await runIpScenario(browser, url);
    console.log(live ? 'Live headless smoke test passed' : 'Headless smoke test passed');
  } finally {
    await browser.close();
    await server.close();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
