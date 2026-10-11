import { describe, it, expect, afterEach } from 'vitest';
import { installBrowser } from './helpers/browserProfile.js';
import { createDetector } from '../src/index.js';
import { MouseMovementSignal } from '../src/signals/behavior/MouseMovementSignal.js';
import { KeyboardPatternSignal } from '../src/signals/behavior/KeyboardPatternSignal.js';
import { ScrollBehaviorSignal } from '../src/signals/behavior/ScrollBehaviorSignal.js';
import { InteractionTimingSignal } from '../src/signals/behavior/InteractionTimingSignal.js';
import { HeadlessSignal } from '../src/signals/environment/HeadlessSignal.js';
import { NavigatorAnomalySignal } from '../src/signals/environment/NavigatorAnomalySignal.js';
import { PermissionsSignal } from '../src/signals/environment/PermissionsSignal.js';
import { PluginsSignal } from '../src/signals/fingerprint/PluginsSignal.js';
import { WebGLSignal } from '../src/signals/fingerprint/WebGLSignal.js';
import { AudioContextSignal } from '../src/signals/fingerprint/AudioContextSignal.js';
import { ScreenSignal } from '../src/signals/fingerprint/ScreenSignal.js';
import { PageLoadSignal } from '../src/signals/timing/PageLoadSignal.js';
import { DOMContentTimingSignal } from '../src/signals/timing/DOMContentTimingSignal.js';
import { PuppeteerSignal } from '../src/signals/automation/PuppeteerSignal.js';
import { PlaywrightSignal } from '../src/signals/automation/PlaywrightSignal.js';
import { PhantomJSSignal } from '../src/signals/automation/PhantomJSSignal.js';

/**
 * Regression suite for false positives: every case below is a real, healthy
 * browser/user that an earlier version of this library classified as a bot.
 */

let restoreEnv = null;

afterEach(() => {
  if (restoreEnv) {
    restoreEnv();
    restoreEnv = null;
  }
});

/**
 * Create an event that looks like it came from the user rather than from a
 * script. Events constructed in JS report isTrusted === false.
 * @param {string} type - Event type.
 * @param {Object} init - Event init dictionary.
 * @returns {Event}
 */
function trustedEvent(type, init = {}) {
  const Ctor = type.startsWith('key') ? KeyboardEvent
    : (type.startsWith('mouse') || type.startsWith('pointer')) ? MouseEvent
      : Event;
  const event = new Ctor(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, 'isTrusted', { value: true, configurable: true });
  return event;
}

/**
 * Create an event that looks like it was dispatched by a script rather than by
 * a user. happy-dom leaves isTrusted undefined on constructed events, so it has
 * to be forced to false to represent the real thing.
 * @param {string} type - Event type.
 * @returns {Event}
 */
function syntheticEvent(type) {
  const event = new MouseEvent(type, { bubbles: true });
  Object.defineProperty(event, 'isTrusted', { value: false, configurable: true });
  return event;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Realistic human browser profiles. Every one of these must come out 'human'.
 */
const HUMAN_PROFILES = {
  'desktop Chrome on Windows': {},

  'desktop Chrome on a touchscreen laptop': {
    maxTouchPoints: 10,
  },

  'Firefox on Linux with a Mesa/Intel GPU': {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
    platform: 'Linux x86_64',
    vendor: '',
    deviceMemory: undefined,
    hasConnectionApi: false,
    chromeObject: undefined,
    plugins: [
      { name: 'OpenH264 Video Codec', length: 1 },
      { name: 'Widevine Content Decryption Module', length: 1 },
    ],
    mimeTypes: [{ type: 'video/mp4' }],
    webgl: {
      debugInfoAvailable: true,
      vendor: 'Intel',
      renderer: 'Mesa Intel(R) UHD Graphics 630 (CFL GT2)',
      extensionCount: 40,
      maxTextureSize: 16384,
    },
    audio: { sampleRate: 48000, maxChannelCount: 6, state: 'running' },
  },

  'Safari on macOS': {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    platform: 'MacIntel',
    vendor: 'Apple Computer, Inc.',
    deviceMemory: undefined,
    hasConnectionApi: false,
    chromeObject: undefined,
    plugins: [],
    mimeTypes: [],
    outer: [1440, 900],
    inner: [1440, 764],
    screen: {
      width: 1440, height: 900, availWidth: 1440, availHeight: 875,
      colorDepth: 30, pixelDepth: 30, orientationType: 'landscape-primary',
    },
    dpr: 2,
    permissionStates: {}, // Safari rejects unknown permission names
    webgl: {
      debugInfoAvailable: true,
      vendor: 'Apple',
      renderer: 'Apple M2 Pro',
      extensionCount: 28,
      maxTextureSize: 16384,
    },
    paintTimingSupported: false,
    paintEntries: [],
  },

  'Safari on iOS': {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    platform: 'iPhone',
    vendor: 'Apple Computer, Inc.',
    deviceMemory: undefined,
    hasConnectionApi: false,
    chromeObject: undefined,
    plugins: [],
    mimeTypes: [],
    maxTouchPoints: 5,
    outer: [390, 664],
    inner: [390, 664],
    screen: {
      width: 390, height: 844, availWidth: 390, availHeight: 844,
      colorDepth: 32, pixelDepth: 32, orientationType: 'portrait-primary',
    },
    dpr: 3,
    notificationPermission: undefined,
    permissionStates: {},
    webgl: {
      debugInfoAvailable: true,
      vendor: 'Apple',
      renderer: 'Apple GPU',
      extensionCount: 24,
      maxTextureSize: 16384,
    },
    paintTimingSupported: false,
    paintEntries: [],
  },

  'Chrome on Android': {
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    platform: '',
    deviceMemory: 8,
    chromeObject: undefined,
    plugins: [],
    mimeTypes: [],
    maxTouchPoints: 5,
    outer: [412, 915],
    inner: [412, 787],
    screen: {
      width: 412, height: 915, availWidth: 412, availHeight: 915,
      colorDepth: 24, pixelDepth: 24, orientationType: 'portrait-primary',
    },
    dpr: 2.625,
  },

  'Firefox on Android (reports zero-sized window)': {
    userAgent: 'Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0',
    platform: 'Linux armv8l',
    vendor: '',
    deviceMemory: undefined,
    hasConnectionApi: false,
    chromeObject: undefined,
    plugins: [],
    mimeTypes: [],
    maxTouchPoints: 5,
    outer: [0, 0],
    inner: [412, 787],
    screen: {
      width: 412, height: 915, availWidth: 412, availHeight: 915,
      colorDepth: 24, pixelDepth: 24, orientationType: 'portrait-primary',
    },
    dpr: 2.625,
    webgl: {
      debugInfoAvailable: true,
      vendor: 'Qualcomm',
      renderer: 'Adreno (TM) 740',
      extensionCount: 30,
      maxTextureSize: 16384,
    },
  },

  'current Chrome without WEBGL_debug_renderer_info': {
    webgl: {
      debugInfoAvailable: false,
      vendor: '',
      renderer: '',
      extensionCount: 32,
      maxTextureSize: 16384,
    },
  },

  'Chrome opened in a background tab': {
    hidden: true,
    paintEntries: [],
  },

  'Chrome zoomed out to 33%': {
    dpr: 0.33,
    outer: [5818, 3121],
    inner: [5818, 2786],
    screen: {
      width: 5818, height: 3272, availWidth: 5818, availHeight: 3151,
      colorDepth: 24, pixelDepth: 24, orientationType: 'landscape-primary',
    },
  },

  'Chrome with a Bluetooth headset (24kHz audio)': {
    audio: { sampleRate: 24000, maxChannelCount: 1, state: 'running' },
  },

  'Chrome in F11 fullscreen': {
    displayMode: 'fullscreen',
    outer: [1920, 1080],
    inner: [1920, 1080],
    screen: {
      width: 1920, height: 1080, availWidth: 1920, availHeight: 1080,
      colorDepth: 24, pixelDepth: 24, orientationType: 'landscape-primary',
    },
  },

  'an installed PWA (standalone display mode)': {
    displayMode: 'standalone',
    outer: [1280, 800],
    inner: [1280, 800],
    screen: {
      width: 1440, height: 900, availWidth: 1440, availHeight: 875,
      colorDepth: 24, pixelDepth: 24, orientationType: 'landscape-primary',
    },
  },

  'a warm revisit (keep-alive connection, no DNS/TCP)': {
    timings: {
      domContentLoaded: 342,
      domComplete: 690,
      loadEventEnd: 812,
      dnsLookup: 0,
      tcpConnection: 0,
      serverResponse: 2,
      domProcessing: 348,
      dclStartAfterResponseEnd: 236,
    },
  },

  'a back/forward-cache restore': {
    navigationType: 'back_forward',
    timings: {
      domContentLoaded: 3,
      domComplete: 4,
      loadEventEnd: 5,
      dnsLookup: 0,
      tcpConnection: 0,
      serverResponse: 0,
      domProcessing: 1,
      dclStartAfterResponseEnd: 1,
    },
  },
};

describe('false positives — real users must be classified as human', () => {
  for (const [name, overrides] of Object.entries(HUMAN_PROFILES)) {
    it(`${name}: verdict is human`, async () => {
      restoreEnv = installBrowser(overrides);

      const detector = createDetector({ includeInteractionSignals: false });
      const result = await detector.detect();

      const triggered = result.triggeredSignals
        .map(id => `${id}(${result.signals[id].confidence})`)
        .join(', ');

      expect(result.verdict, `expected human, triggered: ${triggered}`).toBe('human');
    });
  }
});

describe('false positives — per-signal regressions', () => {
  it('HeadlessSignal: empty plugin list is normal on mobile and on Safari', async () => {
    restoreEnv = installBrowser({
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
      plugins: [],
      mimeTypes: [],
      maxTouchPoints: 5,
      chromeObject: undefined,
      hasConnectionApi: true,
    });

    const result = await new HeadlessSignal().run();
    expect(result.value.indicators).not.toContain('no-plugins');
    expect(result.triggered).toBe(false);
  });

  it('HeadlessSignal: a missing Network Information API alone does not trigger', async () => {
    restoreEnv = installBrowser({ hasConnectionApi: false });

    const result = await new HeadlessSignal().run();
    expect(result.value.indicators).toContain('missing-connection-api');
    expect(result.triggered).toBe(false);
  });

  it('NavigatorAnomalySignal: a Windows touchscreen laptop is not an anomaly', async () => {
    restoreEnv = installBrowser({ maxTouchPoints: 10 });

    const result = await new NavigatorAnomalySignal().run();
    expect(result.value.anomalies).not.toContain('desktop-high-touch-points');
    expect(result.triggered).toBe(false);
  });

  it('NavigatorAnomalySignal: a spoofed mobile UA with no touch support is still flagged', async () => {
    restoreEnv = installBrowser({
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
      maxTouchPoints: 0,
    });

    const result = await new NavigatorAnomalySignal().run();
    expect(result.value.anomalies).toContain('mobile-ua-without-touch');
  });

  it('PermissionsSignal: an unsupported permission name (Safari) is not an anomaly', async () => {
    restoreEnv = installBrowser({ permissionStates: {} }); // rejects with TypeError

    const result = await new PermissionsSignal().run();
    expect(result.triggered).toBe(false);
  });

  it('PermissionsSignal: a Permissions-Policy rejection (NotAllowedError) is not an anomaly', async () => {
    restoreEnv = installBrowser();
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: {
        query: () => {
          const err = new Error('blocked by permissions policy');
          err.name = 'NotAllowedError';
          return Promise.reject(err);
        },
      },
    });

    try {
      const result = await new PermissionsSignal().run();
      expect(result.triggered).toBe(false);
    } finally {
      delete navigator.permissions;
    }
  });

  it('PluginsSignal: an empty plugin list is only evidence on desktop Chromium', async () => {
    restoreEnv = installBrowser({ plugins: [], mimeTypes: [] });
    const desktopChrome = await new PluginsSignal().run();
    expect(desktopChrome.value.anomalies).toContain('empty-plugins');
    restoreEnv();

    restoreEnv = installBrowser({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
        '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      plugins: [],
      mimeTypes: [],
      maxTouchPoints: 5,
    });
    const iosSafari = await new PluginsSignal().run();
    expect(iosSafari.value.anomalies).not.toContain('empty-plugins');
    expect(iosSafari.triggered).toBe(false);
    restoreEnv();

    // Desktop Safari exposes no plugin list either; only Chromium guarantees one.
    restoreEnv = installBrowser({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ' +
        '(KHTML, like Gecko) Version/17.4 Safari/605.1.15',
      vendor: 'Apple Computer, Inc.',
      plugins: [],
      mimeTypes: [],
    });
    const macSafari = await new PluginsSignal().run();
    expect(macSafari.value.anomalies).not.toContain('empty-plugins');
    expect(macSafari.triggered).toBe(false);
  });

  it('PluginsSignal: one plugin on desktop is no longer suspicious', async () => {
    restoreEnv = installBrowser({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
      vendor: '',
      plugins: [{ name: 'OpenH264 Video Codec', length: 1 }],
      mimeTypes: [{ type: 'video/mp4' }],
    });

    const result = await new PluginsSignal().run();
    expect(result.value.anomalies).not.toContain('minimal-plugins');
    expect(result.triggered).toBe(false);
  });

  it('WebGLSignal: a missing debug-renderer extension is expected in current browsers', async () => {
    restoreEnv = installBrowser({
      webgl: {
        debugInfoAvailable: false,
        vendor: '',
        renderer: '',
        extensionCount: 32,
        maxTextureSize: 16384,
      },
    });

    const result = await new WebGLSignal().run();
    expect(result.value.anomalies).not.toContain('no-webgl-renderer-info');
    expect(result.triggered).toBe(false);
  });

  it('WebGLSignal: Mesa on real Linux hardware is not a software renderer', async () => {
    restoreEnv = installBrowser({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
      vendor: '',
      webgl: {
        debugInfoAvailable: true,
        vendor: 'Intel',
        renderer: 'Mesa Intel(R) UHD Graphics 630 (CFL GT2)',
        extensionCount: 40,
        maxTextureSize: 16384,
      },
    });

    const result = await new WebGLSignal().run();
    expect(result.triggered).toBe(false);
  });

  it('WebGLSignal: an actual software renderer is still detected', async () => {
    restoreEnv = installBrowser({
      webgl: {
        debugInfoAvailable: true,
        vendor: 'Google Inc. (Google)',
        renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0))',
        extensionCount: 20,
        maxTextureSize: 16384,
      },
    });

    const result = await new WebGLSignal().run();
    expect(result.value.anomalies).toContain('suspicious-renderer-swiftshader');
  });

  it('AudioContextSignal: a Bluetooth sample rate and mono output are user settings', async () => {
    restoreEnv = installBrowser({
      audio: { sampleRate: 24000, maxChannelCount: 1, state: 'running' },
    });

    const result = await new AudioContextSignal().run();
    expect(result.value.anomalies).not.toContain('unusual-sample-rate');
    expect(result.value.anomalies).not.toContain('mono-audio-only');
    expect(result.triggered).toBe(false);
  });

  it('ScreenSignal: F11 fullscreen is not "no browser chrome"', async () => {
    restoreEnv = installBrowser({
      displayMode: 'fullscreen',
      outer: [1920, 1080],
      inner: [1920, 1080],
      screen: {
        width: 1920, height: 1080, availWidth: 1920, availHeight: 1080,
        colorDepth: 24, pixelDepth: 24, orientationType: 'landscape-primary',
      },
    });

    const result = await new ScreenSignal().run();
    expect(result.value.anomalies).not.toContain('no-browser-chrome');
    expect(result.value.anomalies).not.toContain('headless-default-dimensions');
    expect(result.triggered).toBe(false);
  });

  it('ScreenSignal: mobile Firefox reporting a 0x0 window is not headless', async () => {
    restoreEnv = installBrowser({
      userAgent: 'Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0',
      vendor: '',
      outer: [0, 0],
      inner: [412, 787],
      maxTouchPoints: 5,
    });

    const result = await new ScreenSignal().run();
    expect(result.value.anomalies).not.toContain('zero-outer-dimensions');
    expect(result.triggered).toBe(false);
  });

  it('ScreenSignal: browser zoom changing devicePixelRatio is not an anomaly', async () => {
    restoreEnv = installBrowser({
      dpr: 0.33,
      outer: [5818, 3121],
      inner: [5818, 2786],
      screen: {
        width: 5818, height: 3272, availWidth: 5818, availHeight: 3151,
        colorDepth: 24, pixelDepth: 24, orientationType: 'landscape-primary',
      },
    });

    const result = await new ScreenSignal().run();
    expect(result.value.anomalies).not.toContain('unusual-device-pixel-ratio');
    expect(result.triggered).toBe(false);
  });

  it('PageLoadSignal: a warm connection with zero DNS/TCP time is not suspicious', async () => {
    restoreEnv = installBrowser({
      timings: {
        domContentLoaded: 342,
        domComplete: 690,
        loadEventEnd: 812,
        dnsLookup: 0,
        tcpConnection: 0,
        serverResponse: 2,
        domProcessing: 348,
        dclStartAfterResponseEnd: 236,
      },
    });

    const result = await new PageLoadSignal().run();
    expect(result.value.anomalies).not.toContain('zero-network-timing');
    expect(result.value.anomalies).not.toContain('instant-script-execution');
    expect(result.triggered).toBe(false);
  });

  it('PageLoadSignal: a back/forward-cache restore is skipped entirely', async () => {
    restoreEnv = installBrowser({
      navigationType: 'back_forward',
      timings: {
        domContentLoaded: 3, domComplete: 4, loadEventEnd: 5,
        dnsLookup: 0, tcpConnection: 0, serverResponse: 0,
        domProcessing: 1, dclStartAfterResponseEnd: 1,
      },
    });

    const result = await new PageLoadSignal().run();
    expect(result.triggered).toBe(false);
    expect(result.value.reason).toBe('restored-navigation');
  });

  it('PageLoadSignal: an impossible load time is still detected', async () => {
    restoreEnv = installBrowser({
      timings: {
        domContentLoaded: 2, domComplete: 3, loadEventEnd: 4,
        dnsLookup: 0, tcpConnection: 0, serverResponse: 0,
        domProcessing: 1, dclStartAfterResponseEnd: 1,
      },
    });

    const result = await new PageLoadSignal().run();
    expect(result.value.anomalies).toContain('instant-dom-content-loaded');
    expect(result.triggered).toBe(true);
  });

  it('DOMContentTimingSignal: fast DOM operations under a quantized clock are normal', async () => {
    restoreEnv = installBrowser();

    const result = await new DOMContentTimingSignal().run();
    expect(result.value.anomalies).not.toContain('instant-dom-operations');
    expect(result.triggered).toBe(false);
  });

  it('DOMContentTimingSignal: a background tab is not flagged for never painting', async () => {
    restoreEnv = installBrowser({ hidden: true, paintEntries: [] });

    const result = await new DOMContentTimingSignal().run();
    expect(result.value.anomalies).not.toContain('no-first-contentful-paint');
    expect(result.value.anomalies).not.toContain('no-first-paint');
    expect(result.value.anomalies).not.toContain('hidden-at-load');
  });

  it('DOMContentTimingSignal: Safari without the Paint Timing API is not flagged', async () => {
    restoreEnv = installBrowser({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ' +
        '(KHTML, like Gecko) Version/17.4 Safari/605.1.15',
      vendor: 'Apple Computer, Inc.',
      paintTimingSupported: false,
      paintEntries: [],
    });

    const result = await new DOMContentTimingSignal().run();
    expect(result.value.anomalies).not.toContain('no-first-contentful-paint');
  });

  it('automation signals: no longer scan stack traces, so page URLs cannot flag a human', async () => {
    restoreEnv = installBrowser();
    const originalStack = Object.getOwnPropertyDescriptor(Error.prototype, 'stack');
    Object.defineProperty(Error.prototype, 'stack', {
      configurable: true,
      get: () => 'Error: probe\n    at https://pptr.dev/guide/puppeteer.js:12:5\n' +
        '    at __pwInitScripts (https://playwright.dev/docs/main.js:3:1)',
    });

    try {
      const results = await Promise.all([
        new PuppeteerSignal().run(),
        new PlaywrightSignal().run(),
        new PhantomJSSignal().run(),
      ]);
      for (const result of results) {
        expect(result.triggered).toBe(false);
        expect(result.value.indicators.some(i => i.startsWith('stack-trace'))).toBe(false);
      }
    } finally {
      if (originalStack) {
        Object.defineProperty(Error.prototype, 'stack', originalStack);
      } else {
        delete Error.prototype.stack;
      }
    }
  });

  it('PuppeteerSignal: a default-looking 800x600 viewport alone is not a bot', async () => {
    restoreEnv = installBrowser({ inner: [800, 600], outer: [816, 700] });

    const result = await new PuppeteerSignal().run();
    expect(result.value.indicators).toContain('default-viewport');
    expect(result.triggered).toBe(false);
  });

  it('PlaywrightSignal: PWA globals starting with __pw are not Playwright bindings', async () => {
    restoreEnv = installBrowser();
    window.__pwaInstalled = () => {};
    window.__pwaReady = () => {};
    window.__pwaUpdate = () => {};

    try {
      const result = await new PlaywrightSignal().run();
      expect(result.value.indicators).not.toContain('pw-bindings');
      expect(result.triggered).toBe(false);
    } finally {
      delete window.__pwaInstalled;
      delete window.__pwaReady;
      delete window.__pwaUpdate;
    }
  });

  it('end to end: a real human on a site defining __pwa* globals is not an instant bot', async () => {
    restoreEnv = installBrowser();
    window.__pwaInstalled = () => {};
    window.__pwaReady = () => {};
    window.__pwaUpdate = () => {};

    try {
      const result = await createDetector({ includeInteractionSignals: false }).detect();
      // `playwright` is an instant-bot signal, so a single bogus indicator here
      // used to be enough to condemn the visitor outright.
      expect(result.verdict).toBe('human');
      expect(result.triggeredSignals).not.toContain('playwright');
    } finally {
      delete window.__pwaInstalled;
      delete window.__pwaReady;
      delete window.__pwaUpdate;
    }
  });

  it('PlaywrightSignal: HeadlessChrome in the UA belongs to HeadlessSignal only', async () => {
    restoreEnv = installBrowser({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'HeadlessChrome/131.0.0.0 Safari/537.36',
      chromeObject: undefined,
    });

    const playwright = await new PlaywrightSignal().run();
    const puppeteer = await new PuppeteerSignal().run();
    const headless = await new HeadlessSignal().run();

    expect(playwright.value.indicators).not.toContain('playwright-ua-marker');
    expect(puppeteer.value.indicators).not.toContain('headless-chrome-ua');
    expect(headless.value.indicators).toContain('headless-ua');
  });
});

describe('false positives — behavioural signals', () => {
  it('MouseMovementSignal: no mouse movement (touch/keyboard user) does not trigger', async () => {
    restoreEnv = installBrowser({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
        '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      maxTouchPoints: 5,
    });

    const signal = new MouseMovementSignal({ trackingDuration: 10 });
    const result = await signal.run();

    expect(result.triggered).toBe(false);
    expect(result.value.reason).toBe('insufficient-mouse-data');
  });

  it('MouseMovementSignal: a straight human move to a button does not trigger', async () => {
    restoreEnv = installBrowser();

    const signal = new MouseMovementSignal();
    const now = performance.now();
    // A human dragging the cursor diagonally to a button: straight path, but
    // with a natural ease-in/ease-out speed profile.
    const steps = 12;
    for (let i = 0; i < steps; i++) {
      const eased = Math.pow(i / (steps - 1), 0.6);
      signal._movements.push({
        x: 100 + eased * 400,
        y: 200 + eased * 200,
        t: now - (steps - i) * 16,
      });
    }

    const result = await signal.run();
    expect(result.value.analysis.linearPathRatio).toBeGreaterThan(0.9);
    expect(result.value.anomalies).not.toContain('linear-path');
    expect(result.triggered).toBe(false);
  });

  it('MouseMovementSignal: frame-quantized timing is not read as robotic', async () => {
    restoreEnv = installBrowser();

    const signal = new MouseMovementSignal();
    // No coalesced-event support means the events arrive once per frame.
    expect(signal._inputMayBeFrameQuantized).toBe(true);

    const now = performance.now();
    for (let i = 0; i < 20; i++) {
      signal._movements.push({
        x: 100 + i * 7 + (i % 3),
        y: 200 + i * 4 - (i % 2),
        t: now - (20 - i) * 16.6667,
      });
    }

    const result = await signal.run();
    expect(result.value.analysis.timingCV).toBeLessThan(0.02);
    expect(result.value.anomalies).not.toContain('robotic-timing');
    expect(result.triggered).toBe(false);
  });

  it('MouseMovementSignal: a perfectly linear constant-velocity bot still triggers', async () => {
    restoreEnv = installBrowser();

    const signal = new MouseMovementSignal();
    const now = performance.now();
    for (let i = 0; i < 30; i++) {
      signal._movements.push({ x: 100 + i * 10, y: 200 + i * 10, t: now - (30 - i) * 8 });
    }

    const result = await signal.run();
    expect(result.value.anomalies).toContain('linear-path');
    expect(result.value.anomalies).toContain('constant-velocity');
    expect(result.triggered).toBe(true);
  });

  it('KeyboardPatternSignal: holding a key down (auto-repeat) is not inhuman typing', async () => {
    restoreEnv = installBrowser();

    const signal = new KeyboardPatternSignal();
    const now = performance.now();
    // Ten real keystrokes...
    for (let i = 0; i < 10; i++) {
      signal._keystrokes.push({ type: 'down', key: 'a', code: 'KeyA', repeat: false, t: now - 2000 + i * 180 });
      signal._keystrokes.push({ type: 'up', key: 'a', code: 'KeyA', repeat: false, t: now - 2000 + i * 180 + 70 });
    }
    // ...plus a held backspace repeating at 30/s with no keyups.
    for (let i = 0; i < 40; i++) {
      signal._keystrokes.push({ type: 'down', key: 'Backspace', code: 'Backspace', repeat: true, t: now - 200 + i * 33 });
    }
    signal._keystrokes.sort((a, b) => a.t - b.t);

    const result = await signal.run();
    expect(result.value.keystrokeCount).toBe(10);
    expect(result.value.anomalies).not.toContain('inhuman-speed');
    expect(result.value.anomalies).not.toContain('missing-keyups');
    expect(result.triggered).toBe(false);
  });

  it('KeyboardPatternSignal: a soft keyboard without keyup events does not trigger', async () => {
    restoreEnv = installBrowser({
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
      maxTouchPoints: 5,
    });

    const signal = new KeyboardPatternSignal();
    const now = performance.now();
    for (let i = 0; i < 14; i++) {
      signal._keystrokes.push({
        type: 'down', key: 'Unidentified', code: '', repeat: false, t: now - 1400 + i * 110,
      });
    }

    const result = await signal.run();
    expect(result.value.anomalies).not.toContain('missing-keyups');
    expect(result.triggered).toBe(false);
  });

  it('ScrollBehaviorSignal: ordinary mouse-wheel scrolling does not trigger', async () => {
    restoreEnv = installBrowser();

    const signal = new ScrollBehaviorSignal();
    const now = performance.now();
    // 20 wheel notches of 100px each, arriving roughly once per frame but with
    // the natural jitter of a hand on a wheel, passing through 100/200/... and
    // coming to rest on a multiple of 100 — all completely normal.
    const jitter = [0, 4, -3, 6, -5, 2, -2, 5, -4, 3, -6, 4, -1, 6, -3, 2, -5, 3, -2, 4];
    for (let i = 0; i < 20; i++) {
      signal._scrollEvents.push({
        scrollY: i * 100,
        scrollX: 0,
        t: now - (20 - i) * 16.6 + jitter[i],
      });
    }

    const result = await signal.run();
    expect(result.value.anomalies).not.toContain('robotic-scroll-timing');
    expect(result.value.anomalies).not.toContain('no-scroll-momentum');
    expect(result.value.anomalies).not.toContain('exact-position-scrolls');
    expect(result.value.anomalies).not.toContain('constant-scroll-velocity');
    expect(result.triggered).toBe(false);
  });

  it('ScrollBehaviorSignal: a programmatic jump is still detected', async () => {
    restoreEnv = installBrowser();

    const signal = new ScrollBehaviorSignal();
    const now = performance.now();
    signal._scrollEvents.push({ scrollY: 0, scrollX: 0, t: now - 100 });
    signal._scrollEvents.push({ scrollY: 900, scrollX: 0, t: now - 99.5 });
    signal._scrollEvents.push({ scrollY: 900, scrollX: 0, t: now - 80 });

    const result = await signal.run();
    expect(result.value.anomalies).toContain('instant-scroll-jumps');
    expect(result.triggered).toBe(true);
  });

  it('InteractionTimingSignal: time to first interaction is measured from page load', async () => {
    restoreEnv = installBrowser();

    const signal = new InteractionTimingSignal({ trackingDuration: 5 });
    signal.startTracking();
    const before = performance.now();
    document.dispatchEvent(trustedEvent('click'));
    signal.stopTracking();

    const result = await signal.run();
    // Must be measured against navigation start, not against the moment the
    // signal happened to be constructed.
    expect(result.value.timeToFirstInteraction).toBeGreaterThanOrEqual(before - 1);
    expect(result.value.anomalies).not.toContain('instant-interaction');
    expect(result.triggered).toBe(false);
  });

  it('InteractionTimingSignal: scroll events and synthetic events are ignored', async () => {
    restoreEnv = installBrowser();

    const signal = new InteractionTimingSignal({ trackingDuration: 5 });
    signal.startTracking();
    for (let i = 0; i < 8; i++) {
      document.dispatchEvent(trustedEvent('scroll'));
    }
    document.dispatchEvent(syntheticEvent('click'));
    signal.stopTracking();

    const result = await signal.run();
    expect(result.value.reason ?? 'no-interactions').toBe('no-interactions');
    expect(result.triggered).toBe(false);
  });

  it('InteractionTimingSignal: typing a sentence is not a "repeated sequence"', async () => {
    restoreEnv = installBrowser();

    const signal = new InteractionTimingSignal();
    const now = performance.now();
    // A sentence typed by a human: roughly 120ms between keys, but with the
    // pauses and speed-ups real typing has.
    const gaps = [110, 95, 180, 88, 140, 76, 210, 102, 130, 84, 165, 97];
    let t = now - gaps.reduce((a, b) => a + b, 0);
    for (let i = 0; i < 12; i++) {
      t += gaps[i];
      signal._interactions.push({ type: 'keydown', t, timeSinceLoad: 5000 + i * 120 });
    }

    const result = await signal.run();
    expect(result.value.anomalies).not.toContain('repeated-sequence');
    expect(result.triggered).toBe(false);
  });
});

describe('detection still works — no over-correction', () => {
  it('navigator.webdriver = true is an instant bot', async () => {
    restoreEnv = installBrowser({ webdriver: true });

    const detector = createDetector({ includeInteractionSignals: false });
    const result = await detector.detect();

    expect(result.verdict).toBe('bot');
    expect(result.triggeredSignals).toContain('webdriver');
  });

  it('a Puppeteer evaluation marker is an instant bot', async () => {
    restoreEnv = installBrowser();
    window.__puppeteer_evaluation_script__ = true;
    try {
      const detector = createDetector({ includeInteractionSignals: false });
      const result = await detector.detect();

      expect(result.verdict).toBe('bot');
      expect(result.triggeredSignals).toContain('puppeteer');
    } finally {
      delete window.__puppeteer_evaluation_script__;
    }
  });

  it('a headless browser fingerprint still scores high', async () => {
    const stealthOverrides = {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'HeadlessChrome/131.0.0.0 Safari/537.36',
      chromeObject: undefined,
      plugins: [],
      mimeTypes: [],
      languages: [],
      outer: [0, 0],
      webgl: {
        debugInfoAvailable: true,
        vendor: 'Google Inc. (Google)',
        renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0))',
        extensionCount: 20,
        maxTextureSize: 16384,
      },
    };

    // Default headless Chrome: navigator.webdriver is still set, which is an
    // instant bot verdict.
    restoreEnv = installBrowser({ ...stealthOverrides, webdriver: true });
    let detector = createDetector({ includeInteractionSignals: false });
    let result = await detector.detect();
    expect(result.verdict).toBe('bot');
    expect(result.triggeredSignals).toContain('webdriver');
    restoreEnv();

    // The same browser with webdriver hidden: the accumulated environment
    // evidence must still light up, and score far above any real user.
    restoreEnv = installBrowser({ ...stealthOverrides, webdriver: false });
    detector = createDetector({ includeInteractionSignals: false });
    result = await detector.detect();

    expect(result.triggeredSignals).toEqual(
      expect.arrayContaining(['headless', 'webgl', 'plugins', 'screen'])
    );
    expect(result.score).toBeGreaterThanOrEqual(15);
  });

  it('a synthetic event stream from a script is not counted as human interaction', async () => {
    restoreEnv = installBrowser();

    const signal = new InteractionTimingSignal({ trackingDuration: 5 });
    signal.startTracking();
    for (let i = 0; i < 6; i++) {
      document.dispatchEvent(syntheticEvent('click'));
      await sleep(1);
    }
    signal.stopTracking();

    const result = await signal.run();
    expect(result.triggered).toBe(false);
    expect(result.value.reason).toBe('no-interactions');
  });
});
