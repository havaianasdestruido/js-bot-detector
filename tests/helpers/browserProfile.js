/**
 * Test helper: installs a realistic browser environment on top of happy-dom.
 *
 * happy-dom ships without WebGL, canvas rendering, AudioContext, the legacy
 * PerformanceTiming object or a configurable navigator, so every signal that
 * touches those APIs would take its "capability missing" branch and the result
 * would say nothing about real-world false positives.
 *
 * `installBrowser(profile)` patches exactly those globals, using values taken
 * from real browsers, and returns a `restore()` that puts everything back.
 * This file is test-only and is not part of the published package.
 */

const NATIVE = (name) => `function ${name}() { [native code] }`;

/**
 * Define a property and remember how to undo it.
 * @param {Object} target - Object to patch.
 * @param {string} key - Property name.
 * @param {*} value - New value.
 * @param {Array<Function>} undo - Stack collecting the restore functions.
 */
function setProp(target, key, value, undo) {
  if (!target) return;
  const had = Object.prototype.hasOwnProperty.call(target, key);
  const previous = Object.getOwnPropertyDescriptor(target, key);
  try {
    Object.defineProperty(target, key, { value, configurable: true, writable: true });
  } catch (e) {
    return;
  }
  undo.push(() => {
    if (had && previous) {
      Object.defineProperty(target, key, previous);
    } else {
      try { delete target[key]; } catch (err) { /* ignore */ }
    }
  });
}

/**
 * Define a getter on a prototype that reports itself as native code.
 *
 * Real browsers expose every navigator property as a native accessor on
 * Navigator.prototype, and several signals deliberately check for that (a
 * non-native getter means something patched the browser). happy-dom implements
 * them in JS, so without this the harness would look like a spoofed browser.
 *
 * @param {Object} proto - Prototype to patch.
 * @param {string} key - Property name.
 * @param {Function} getValue - Returns the value to report.
 * @param {Array<Function>} undo - Stack collecting the restore functions.
 */
function setNativeGetter(proto, key, getValue, undo) {
  if (!proto) return;
  const had = Object.prototype.hasOwnProperty.call(proto, key);
  const previous = Object.getOwnPropertyDescriptor(proto, key);
  const getter = function () {
    return getValue();
  };
  Object.defineProperty(getter, 'toString', {
    value: () => NATIVE(`get ${key}`),
    configurable: true,
  });
  try {
    Object.defineProperty(proto, key, { get: getter, configurable: true, enumerable: true });
  } catch (e) {
    return;
  }
  undo.push(() => {
    if (had && previous) {
      Object.defineProperty(proto, key, previous);
    } else {
      try { delete proto[key]; } catch (err) { /* ignore */ }
    }
  });
}

/**
 * Build a 2D canvas context good enough for CanvasSignal.
 * @param {Object} canvas - The canvas element being patched.
 * @param {Object} state - Shared drawing state.
 * @returns {Object} A stub 2D context.
 */
function make2dContext(canvas, state) {
  const ctx = {
    canvas,
    textBaseline: 'alphabetic',
    font: '10px sans-serif',
    fillStyle: '#000',
    fillRect() { state.drawn = true; },
    fillText() { state.drawn = true; },
    beginPath() {},
    arc() { state.drawn = true; },
    closePath() {},
    fill() { state.drawn = true; },
    clearRect() {},
    getImageData(x, y, w, h) {
      // Non-uniform pixel data, like a real rendered canvas.
      const data = new Uint8ClampedArray(Math.max(4, w * h * 4));
      for (let i = 0; i < data.length; i++) {
        data[i] = (i * 37 + (state.drawn ? 11 : 0)) % 256;
      }
      return { data, width: w, height: h };
    },
  };
  return ctx;
}

/**
 * Build a WebGL context good enough for WebGLSignal.
 * @param {Object} webgl - Profile settings.
 * @returns {Object} A stub WebGLRenderingContext.
 */
function makeWebGLContext(webgl) {
  const UNMASKED_VENDOR = 37445;
  const UNMASKED_RENDERER = 37446;
  const gl = {
    MAX_TEXTURE_SIZE: 3379,
    MAX_VIEWPORT_DIMS: 3386,
    RGBA: 6408,
    UNSIGNED_BYTE: 5121,
    COLOR_BUFFER_BIT: 16384,
    getExtension(name) {
      if (name === 'WEBGL_debug_renderer_info') {
        return webgl.debugInfoAvailable
          ? { UNMASKED_VENDOR_WEBGL: UNMASKED_VENDOR, UNMASKED_RENDERER_WEBGL: UNMASKED_RENDERER }
          : null;
      }
      if (name === 'WEBGL_lose_context') {
        return { loseContext() {} };
      }
      return null;
    },
    getParameter(pname) {
      if (pname === UNMASKED_VENDOR) return webgl.vendor;
      if (pname === UNMASKED_RENDERER) return webgl.renderer;
      if (pname === 3379) return webgl.maxTextureSize;
      if (pname === 3386) return [webgl.maxTextureSize, webgl.maxTextureSize];
      return null;
    },
    getSupportedExtensions() {
      return new Array(webgl.extensionCount).fill('EXT_stub').map((n, i) => `${n}_${i}`);
    },
    clearColor() {},
    clear() {},
    readPixels(x, y, w, h, format, type, pixels) {
      pixels[0] = 0; pixels[1] = 0; pixels[2] = 0; pixels[3] = 255;
    },
  };
  return gl;
}

/**
 * A minimal AudioContext that behaves like a real one.
 * @param {Object} audio - Profile settings.
 * @returns {Function} The AudioContext constructor.
 */
function makeAudioContextClass(audio) {
  function FakeAudioContext() {
    this.sampleRate = audio.sampleRate;
    this.state = audio.state;
    this.destination = { maxChannelCount: audio.maxChannelCount };
  }
  FakeAudioContext.prototype.createOscillator = function createOscillator() {
    return {
      type: 'sine',
      frequency: { value: 440 },
      connect() {},
      disconnect() {},
      start() {},
      stop() {},
    };
  };
  FakeAudioContext.prototype.createAnalyser = function createAnalyser() {
    return { fftSize: 2048, connect() {}, disconnect() {} };
  };
  FakeAudioContext.prototype.createGain = function createGain() {
    return { gain: { value: 1 }, connect() {}, disconnect() {} };
  };
  FakeAudioContext.prototype.createScriptProcessor = function createScriptProcessor() {
    return { connect() {}, disconnect() {} };
  };
  FakeAudioContext.prototype.resume = function resume() {
    return Promise.resolve();
  };
  FakeAudioContext.prototype.close = function close() {
    return Promise.resolve();
  };
  Object.defineProperty(FakeAudioContext, 'toString', {
    value: () => NATIVE('AudioContext'),
    configurable: true,
  });
  return FakeAudioContext;
}

/**
 * Default profile: a current desktop Chrome on Windows, which is the case the
 * original heuristics were implicitly written against.
 */
const BASE_PROFILE = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  platform: 'Win32',
  vendor: 'Google Inc.',
  languages: ['en-US', 'en'],
  language: 'en-US',
  maxTouchPoints: 0,
  hardwareConcurrency: 8,
  deviceMemory: 8,
  webdriver: false,
  hasConnectionApi: true,
  chromeObject: {},
  plugins: [
    { name: 'PDF Viewer', length: 1 },
    { name: 'Chrome PDF Viewer', length: 1 },
    { name: 'Chromium PDF Viewer', length: 1 },
    { name: 'Microsoft Edge PDF Viewer', length: 1 },
    { name: 'WebKit built-in PDF', length: 1 },
  ],
  mimeTypes: [{ type: 'application/pdf' }, { type: 'text/pdf' }],
  outer: [1920, 1032],
  inner: [1920, 919],
  screen: {
    width: 1920, height: 1080, availWidth: 1920, availHeight: 1040,
    colorDepth: 24, pixelDepth: 24, orientationType: 'landscape-primary',
  },
  dpr: 1,
  notificationPermission: 'default',
  permissionStates: { notifications: 'prompt', geolocation: 'prompt', camera: 'prompt' },
  webgl: {
    debugInfoAvailable: true,
    vendor: 'Google Inc. (NVIDIA)',
    renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    extensionCount: 32,
    maxTextureSize: 16384,
  },
  audio: { sampleRate: 48000, maxChannelCount: 2, state: 'running' },
  canvasSupported: true,
  paintTimingSupported: true,
  paintEntries: [
    { name: 'first-paint', startTime: 412 },
    { name: 'first-contentful-paint', startTime: 412 },
  ],
  resourceCount: 27,
  navigationType: 'navigate',
  hasLegacyTiming: true,
  // Milliseconds, relative to navigationStart, of a normal warm page load.
  timings: {
    domContentLoaded: 342,
    domComplete: 690,
    loadEventEnd: 812,
    dnsLookup: 18,
    tcpConnection: 24,
    serverResponse: 96,
    domProcessing: 348,
    dclStartAfterResponseEnd: 236,
  },
  displayMode: 'browser',
  hidden: false,
};

/**
 * Install a browser profile onto the global environment.
 * @param {Object} [overrides={}] - Profile fields to override.
 * @returns {Function} restore - Call to undo every patch.
 */
function installBrowser(overrides = {}) {
  const profile = { ...BASE_PROFILE, ...overrides };
  const undo = [];

  // ── navigator ─────────────────────────────────────────────────────────────
  // Properties are installed as native-looking prototype getters, exactly like
  // a real engine exposes them.
  const navProto = Object.getPrototypeOf(navigator);
  setNativeGetter(navProto, 'userAgent', () => profile.userAgent, undo);
  setNativeGetter(navProto, 'appVersion', () => profile.userAgent.replace('Mozilla/', ''), undo);
  setNativeGetter(navProto, 'platform', () => profile.platform, undo);
  setNativeGetter(navProto, 'vendor', () => profile.vendor, undo);
  setNativeGetter(navProto, 'languages', () => profile.languages, undo);
  setNativeGetter(navProto, 'language', () => profile.language, undo);
  setNativeGetter(navProto, 'maxTouchPoints', () => profile.maxTouchPoints, undo);
  setNativeGetter(navProto, 'hardwareConcurrency', () => profile.hardwareConcurrency, undo);
  setNativeGetter(navProto, 'webdriver', () => profile.webdriver, undo);
  setNativeGetter(navProto, 'plugins', () => profile.plugins, undo);
  setNativeGetter(navProto, 'mimeTypes', () => profile.mimeTypes, undo);
  setNativeGetter(navProto, 'deviceMemory', () => profile.deviceMemory, undo);
  setNativeGetter(navProto, 'connection',
    () => (profile.hasConnectionApi ? { effectiveType: '4g', downlink: 10 } : undefined), undo);
  setNativeGetter(navProto, 'permissions', () => ({
    query: (descriptor) => {
      const state = profile.permissionStates?.[descriptor?.name];
      if (state === undefined) {
        const err = new Error(`Failed to execute 'query': '${descriptor?.name}' is not valid`);
        err.name = 'TypeError';
        return Promise.reject(err);
      }
      return Promise.resolve({ state, onchange: null });
    },
  }), undo);

  // ── window geometry / display ─────────────────────────────────────────────
  setProp(window, 'outerWidth', profile.outer[0], undo);
  setProp(window, 'outerHeight', profile.outer[1], undo);
  setProp(window, 'innerWidth', profile.inner[0], undo);
  setProp(window, 'innerHeight', profile.inner[1], undo);
  setProp(window, 'devicePixelRatio', profile.dpr, undo);
  setProp(window, 'chrome', profile.chromeObject, undo);
  setProp(window, 'scrollX', 0, undo);
  setProp(window, 'scrollY', 0, undo);

  const screenObj = window.screen;
  if (screenObj) {
    setProp(screenObj, 'width', profile.screen.width, undo);
    setProp(screenObj, 'height', profile.screen.height, undo);
    setProp(screenObj, 'availWidth', profile.screen.availWidth, undo);
    setProp(screenObj, 'availHeight', profile.screen.availHeight, undo);
    setProp(screenObj, 'colorDepth', profile.screen.colorDepth, undo);
    setProp(screenObj, 'pixelDepth', profile.screen.pixelDepth, undo);
    if (profile.screen.orientationType) {
      setProp(screenObj, 'orientation', {
        type: profile.screen.orientationType,
        angle: profile.screen.orientationType.includes('landscape') ? 0 : 0,
      }, undo);
    } else {
      setProp(screenObj, 'orientation', undefined, undo);
    }
  }

  // display-mode media queries (fullscreen / installed PWA)
  const realMatchMedia = window.matchMedia ? window.matchMedia.bind(window) : null;
  setProp(window, 'matchMedia', (query) => {
    if (typeof query === 'string' && query.includes('display-mode')) {
      const mode = query.replace(/[^a-z-]*display-mode:\s*([a-z-]+).*/i, '$1');
      return { matches: mode === profile.displayMode, media: query };
    }
    if (typeof query === 'string' && query.includes('hover: none')) {
      return { matches: profile.maxTouchPoints > 0 && profile.touchOnly === true, media: query };
    }
    return realMatchMedia ? realMatchMedia(query) : { matches: false, media: query };
  }, undo);

  // ── document visibility ───────────────────────────────────────────────────
  setProp(document, 'hidden', profile.hidden, undo);
  setProp(document, 'visibilityState', profile.hidden ? 'hidden' : 'visible', undo);
  setProp(document, 'readyState', 'complete', undo);

  // ── Notification + Permissions ────────────────────────────────────────────
  if (profile.notificationPermission === undefined) {
    setProp(window, 'Notification', undefined, undo);
  } else {
    function FakeNotification() {}
    Object.defineProperty(FakeNotification, 'permission', {
      get: () => profile.notificationPermission,
      configurable: true,
    });
    setProp(window, 'Notification', FakeNotification, undo);
  }

  // ── canvas (2D + WebGL) ───────────────────────────────────────────────────
  const canvasProto = window.HTMLCanvasElement?.prototype;
  if (canvasProto) {
    const drawingState = new WeakMap();
    setProp(canvasProto, 'getContext', function getContext(type) {
      if (type === '2d') {
        if (!profile.canvasSupported) return null;
        const state = { drawn: false };
        drawingState.set(this, state);
        return make2dContext(this, state);
      }
      if (type === 'webgl' || type === 'experimental-webgl') {
        if (profile.webgl === null) return null;
        return makeWebGLContext(profile.webgl);
      }
      return null;
    }, undo);

    setProp(canvasProto, 'toDataURL', function toDataURL() {
      const state = drawingState.get(this);
      if (!profile.canvasSupported || !state || !state.drawn) {
        return 'data:image/png;base64,BLANK';
      }
      return `data:image/png;base64,${'RENDERED'.repeat(300)}`;
    }, undo);
    // Signals inspect Function.prototype.toString output of the native methods.
    Object.defineProperty(canvasProto.toDataURL, 'toString', {
      value: () => NATIVE('toDataURL'),
      configurable: true,
    });
  }

  // ── Web Audio ─────────────────────────────────────────────────────────────
  if (profile.audio === null) {
    setProp(window, 'AudioContext', undefined, undo);
    setProp(window, 'OfflineAudioContext', undefined, undo);
  } else {
    const Ctx = makeAudioContextClass(profile.audio);
    setProp(window, 'AudioContext', Ctx, undo);
    setProp(window, 'OfflineAudioContext', Ctx, undo);
  }

  // ── Performance API ───────────────────────────────────────────────────────
  if (profile.hasLegacyTiming) {
    const base = Date.now() - 5000;
    const t = profile.timings;
    setProp(performance, 'timing', {
      navigationStart: base,
      domainLookupStart: base + 1,
      domainLookupEnd: base + 1 + t.dnsLookup,
      connectStart: base + 20,
      connectEnd: base + 20 + t.tcpConnection,
      requestStart: base + 60,
      responseEnd: base + 60 + t.serverResponse,
      domLoading: base + 180,
      domContentLoadedEventStart: base + 60 + t.serverResponse + t.dclStartAfterResponseEnd,
      domContentLoadedEventEnd: base + t.domContentLoaded,
      domComplete: base + t.domComplete,
      loadEventEnd: base + t.loadEventEnd,
    }, undo);
  } else if ('timing' in performance) {
    setProp(performance, 'timing', undefined, undo);
  }

  setProp(performance, 'getEntriesByType', (type) => {
    if (type === 'navigation') {
      return [{
        type: profile.navigationType,
        domContentLoadedEventEnd: profile.timings.domContentLoaded,
        loadEventEnd: profile.timings.loadEventEnd,
        domainLookupStart: 1,
        domainLookupEnd: 1 + profile.timings.dnsLookup,
        requestStart: 60,
        responseEnd: 60 + profile.timings.serverResponse,
      }];
    }
    if (type === 'paint') {
      return profile.paintTimingSupported ? profile.paintEntries : [];
    }
    if (type === 'resource') {
      return new Array(profile.resourceCount).fill(0).map((_, i) => ({
        name: `https://example.com/asset-${i}.js`,
        initiatorType: 'script',
        duration: 40 + i,
      }));
    }
    return [];
  }, undo);

  if (profile.paintTimingSupported) {
    setProp(window, 'PerformancePaintTiming', function PerformancePaintTiming() {}, undo);
  } else if ('PerformancePaintTiming' in window) {
    setProp(window, 'PerformancePaintTiming', undefined, undo);
  }

  return function restore() {
    while (undo.length > 0) {
      const fn = undo.pop();
      try { fn(); } catch (e) { /* ignore */ }
    }
  };
}

export { installBrowser, BASE_PROFILE };
