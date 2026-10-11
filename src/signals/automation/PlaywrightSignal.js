/**
 * @fileoverview Detects Playwright-specific artifacts.
 */

import { Signal } from '../../core/Signal.js';
import { getUserAgent } from '../../core/env.js';

/**
 * Detects artifacts left by Playwright automation.
 * Playwright injects specific objects and leaves traces.
 *
 * False-positive notes:
 *  - `HeadlessChrome` in the user agent belongs to `HeadlessSignal`; repeating
 *    it here double-counted the same evidence across two instant-bot signals.
 *  - A bare `playwright` global is not something Playwright injects, but it is
 *    something ordinary pages define, and this signal short-circuits straight
 *    to a 'bot' verdict — so it was removed.
 *  - Scanning window keys for the `__pw` prefix matched unrelated globals such
 *    as `__pwaInstalled` / `__pwaReady` that PWA helper scripts define. Only
 *    Playwright's actual internal names are checked now.
 *  - Scanning `Error().stack` for "playwright"/"__pw" matched the page URL and
 *    the page's own script URLs, so a human visiting a site with "playwright"
 *    in its URL was instantly classified as a bot. Removed.
 */
class PlaywrightSignal extends Signal {
  static id = 'playwright';
  static category = 'automation';
  static weight = 1.0;
  static description = 'Detects Playwright automation artifacts';

  async detect() {
    const indicators = [];
    let confidence = 0;

    /**
     * Record an indicator.
     * @param {string} id - Indicator identifier.
     * @param {number} value - Confidence this indicator carries.
     */
    const add = (id, value) => {
      indicators.push(id);
      confidence = Math.max(confidence, value);
    };

    // Check for Playwright-injected globals. These are internal names
    // Playwright defines in the page; they are not used by page authors.
    const playwrightGlobals = [
      '__playwright',
      '__pw_manual',
      '__pwInitScripts',
    ];

    for (const global of playwrightGlobals) {
      if (global in window) {
        add(`global-${global}`, 1.0);
      }
    }

    // Check for Playwright's binding pattern
    if (window.__playwright__binding__) {
      add('playwright-binding', 1.0);
    }

    // Check for Playwright-specific user agent markers.
    // `HeadlessChrome` is deliberately not matched here — HeadlessSignal owns
    // that evidence and counting it twice inflated the score of every
    // headless-looking (and some perfectly real) browser.
    const ua = getUserAgent();
    if (ua.includes('Playwright')) {
      add('playwright-ua-marker', 1.0);
    }

    // Check for Playwright's typical initialization patterns
    if (typeof window.__pw_date_intercepted !== 'undefined') {
      add('date-interception', 0.9);
    }

    // Check for Playwright's geolocation mock
    if (window.__pw_geolocation__) {
      add('geolocation-mock', 0.9);
    }

    // Check for Playwright's permission override
    if (window.__pw_permissions__) {
      add('permissions-override', 0.9);
    }

    // Check CDP session artifacts
    if (window.__cdpSession__) {
      add('cdp-session', 0.8);
    }

    // Check for Playwright's timezone mock
    if (window.__pwTimezone__) {
      add('timezone-mock', 0.8);
    }

    const triggered = indicators.length > 0;

    return this.createResult(triggered, { indicators }, confidence);
  }
}

export { PlaywrightSignal };
