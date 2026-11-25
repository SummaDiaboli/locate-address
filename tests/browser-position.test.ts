import { browserGetPosition } from '../src/platform/browser-position';
import type { RawPosition } from '../src/types';

const raw = {
  coords: { latitude: 48.85, longitude: 2.35, accuracy: 15 },
  timestamp: 1_000,
};

const options = {
  enableHighAccuracy: true,
  timeout: 5_000,
  maximumAge: 1_000,
  signal: undefined,
};

describe('browserGetPosition', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects when geolocation is unavailable', async () => {
    vi.stubGlobal('navigator', {});

    await expect(browserGetPosition(options)).rejects.toEqual({
      code: 'GEOLOCATION_UNAVAILABLE',
      message: 'Geolocation is not available',
    });
  });

  it('resolves a position and forwards browser options only', async () => {
    const getCurrentPosition = vi.fn((success: (position: RawPosition) => void) => success(raw));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });

    await expect(browserGetPosition(options)).resolves.toBe(raw);
    expect(getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { enableHighAccuracy: true, timeout: 5_000, maximumAge: 1_000 },
    );
  });

  it('propagates browser position errors', async () => {
    const getCurrentPosition = vi.fn(
      (_success: (position: RawPosition) => void, failure: (error: unknown) => void) => failure({ code: 1 }),
    );
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });

    await expect(browserGetPosition(options)).rejects.toEqual({ code: 1 });
  });

  it('rejects immediately for an already aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const getCurrentPosition = vi.fn();
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });

    await expect(browserGetPosition({ ...options, signal: controller.signal })).rejects.toEqual({
      code: 'ABORTED',
      message: 'Location request was aborted',
    });
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('rejects when the signal aborts before a fix arrives', async () => {
    const controller = new AbortController();
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: vi.fn() } });

    const pending = browserGetPosition({ ...options, signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toEqual({ code: 'ABORTED', message: 'Location request was aborted' });
  });
});
