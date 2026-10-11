/**
 * @fileoverview Shared browser-environment helpers used by detection signals.
 *
 * Many detection heuristics are only valid in a specific kind of browser
 * environment. Mobile browsers, fullscreen tabs, installed PWAs and
 * privacy-hardened browsers legitimately report values that look "wrong" to a
 * heuristic written for desktop Chrome. Centralising those environment checks
 * here keeps the individual signals honest and prevents false positives.
 *
 * Every helper in this module is defensive: it never throws and never assumes
 * a browser global exists.
 */

/**
 * Read the user agent string safely.
 * @returns {string} The user agent, or '' when unavailable.
 */
function getUserAgent() {
  try {
    return (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  } catch (e) {
    return '';
  }
}

/**
 * Whether the user agent belongs to a mobile-class browser.
 * @param {string} [ua] - Optional user agent override (mainly for tests).
 * @returns {boolean}
 */
function isMobileUA(ua = getUserAgent()) {
  return /Android|iPhone|iPad|iPod|Mobile|Windows Phone|webOS|Silk|CriOS|FxiOS/i.test(ua);
}

/**
 * Whether the UA claims a desktop-class browser.
 * @param {string} [ua] - Optional user agent override.
 * @returns {boolean}
 */
function isDesktopUA(ua = getUserAgent()) {
  return !isMobileUA(ua);
}

/**
 * Whether the UA belongs to a Chromium-based browser (Chrome, Edge, Opera, Brave).
 * Chromium UAs contain the `Chrome/` token; Firefox and Safari never do.
 * @param {string} [ua] - Optional user agent override.
 * @returns {boolean}
 */
function isChromiumUA(ua = getUserAgent()) {
  // `HeadlessChrome/` must match too, which is why the tokens are not anchored
  // to a word boundary ("HeadlessChrome" has no boundary before "Chrome").
  return /(Chrome|CriOS|Edg|OPR)\//.test(ua) && !/Chromium/.test(ua);
}

/**
 * Whether the device advertises touch input.
 * Touch capability does NOT imply mobile: Windows touch laptops and
 * touchscreen all-in-ones report `maxTouchPoints` of 10 with a desktop UA.
 * @returns {boolean}
 */
function hasTouchSupport() {
  try {
    if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) {
      return true;
    }
  } catch (e) {
    // ignore
  }
  return matchMediaQuery('(hover: none) and (pointer: coarse)');
}

/**
 * Evaluate a media query defensively.
 * @param {string} query - CSS media query.
 * @returns {boolean} True only when the query matches.
 */
function matchMediaQuery(query) {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return Boolean(window.matchMedia(query)?.matches);
  } catch (e) {
    return false;
  }
}

/**
 * Whether the page is rendered without browser "furniture" for legitimate
 * reasons: F11 fullscreen, macOS fullscreen, an installed PWA
 * (standalone/minimal-ui), or a kiosk display mode.
 * @returns {boolean}
 */
function isFullscreenOrStandalone() {
  return (
    matchMediaQuery('(display-mode: fullscreen)') ||
    matchMediaQuery('(display-mode: standalone)') ||
    matchMediaQuery('(display-mode: minimal-ui)')
  );
}

/**
 * Whether `window.outerWidth` / `window.outerHeight` carry any meaning.
 *
 * They do not when:
 *  - the browser is mobile. Firefox for Android reports 0 for both, and mobile
 *    browsers in general have no window frame to measure.
 *  - the page has no browser chrome by design (fullscreen / installed PWA), in
 *    which case outer === inner === screen is exactly what a real user sees.
 *
 * @returns {boolean}
 */
function windowChromeIsMeaningful() {
  if (isMobileUA()) return false;
  if (isFullscreenOrStandalone()) return false;
  return true;
}

/**
 * Whether the page is currently hidden (background tab, minimized window,
 * prerendered page). Hidden pages legitimately never paint and never receive
 * user input, so behavioural and paint-based signals must not judge them.
 * @returns {boolean}
 */
function isHiddenPage() {
  try {
    if (typeof document === 'undefined') return false;
    return document.hidden === true || document.visibilityState === 'hidden';
  } catch (e) {
    return false;
  }
}

/**
 * Whether the current document was produced by a navigation that skips the
 * network (back/forward cache restore, prerender). Such navigations report
 * near-zero timing values in the Performance APIs, which timing signals would
 * otherwise misread as automation.
 * @returns {boolean}
 */
function isCacheRestoredNavigation() {
  try {
    if (typeof performance === 'undefined' || !performance.getEntriesByType) return false;
    const entry = performance.getEntriesByType('navigation')[0];
    if (!entry) return false;
    return entry.type === 'back_forward' || entry.type === 'prerender';
  } catch (e) {
    return false;
  }
}

export {
  getUserAgent,
  isMobileUA,
  isDesktopUA,
  isChromiumUA,
  hasTouchSupport,
  matchMediaQuery,
  isFullscreenOrStandalone,
  windowChromeIsMeaningful,
  isHiddenPage,
  isCacheRestoredNavigation,
};
