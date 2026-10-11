/**
 * @fileoverview Detects headless browser indicators.
 */

import { Signal } from '../../core/Signal.js';
import {
  getUserAgent,
  isMobileUA,
  isChromiumUA,
  windowChromeIsMeaningful,
} from '../../core/env.js';

/**
 * Detects indicators of headless browser execution.
 * Headless browsers often have missing or inconsistent features.
 *
 * False-positive notes:
 *  - Mobile browsers legitimately report `navigator.plugins.length === 0`
 *    (Android Chrome and iOS Safari expose no plugin list at all).
 *  - Mobile Firefox reports `window.outerWidth/outerHeight` as 0 because it has
 *    no window frame, and `navigator.connection` is a Chromium-only API.
 *  - A single weak indicator must not trigger the signal on its own, so weak
 *    evidence only counts when it corroborates a stronger finding.
 */
class HeadlessSignal extends Signal {
  static id = 'headless';
  static category = 'environment';
  static weight = 0.8;
  static description = 'Detects headless browser indicators';

  /**
   * Confidence floor required for this signal to report `triggered`.
   * Weak indicators stay below it and only ever add corroboration.
   */
  static MIN_TRIGGER_CONFIDENCE = 0.5;

  async detect() {
    const indicators = [];
    let confidence = 0;
    let hasStrongIndicator = false;

    /**
     * Record an indicator.
     * @param {string} id - Indicator identifier.
     * @param {number} value - Confidence this indicator carries.
     * @param {boolean} [strong=true] - Whether it can trigger on its own.
     */
    const add = (id, value, strong = true) => {
      indicators.push(id);
      confidence = Math.max(confidence, value);
      if (strong) hasStrongIndicator = true;
    };

    const ua = getUserAgent();
    const mobile = isMobileUA(ua);
    const chromium = isChromiumUA(ua);

    // Check for HeadlessChrome in user agent
    if (ua.includes('HeadlessChrome')) {
      add('headless-ua', 1.0);
    }

    // Check for missing window.chrome in Chrome (true headless indicator).
    // NOTE: chrome.runtime is only populated inside Chrome extensions, so
    // its absence is perfectly normal for real users without extensions.
    // Only flag when the entire window.chrome object is absent.
    if (ua.includes('Chrome') && !ua.includes('Chromium') && !mobile) {
      if (typeof window.chrome === 'undefined') {
        add('missing-chrome-object', 0.6);
      }
    }

    // Check for empty plugins (common in headless).
    // Mobile browsers never expose a plugin list, so this only means something
    // on a desktop browser — and only on Chromium, where a real Chrome always
    // ships its built-in PDF plugins.
    if (!mobile && chromium && navigator.plugins && navigator.plugins.length === 0) {
      add('no-plugins', 0.5);
    }

    // Check for missing languages. Every modern engine exposes
    // navigator.languages, headless or not, so an empty list is meaningful.
    if (!navigator.languages || navigator.languages.length === 0) {
      add('no-languages', 0.6);
    }

    // Check window dimensions anomalies. outerWidth/outerHeight are only
    // meaningful in a desktop window with browser furniture.
    if (windowChromeIsMeaningful() && window.outerWidth === 0 && window.outerHeight === 0) {
      add('zero-outer-dimensions', 0.7);
    }

    // Check for missing connection info. Network Information is a
    // Chromium-only API, so on its own this is weak evidence at best.
    if (chromium && !mobile && typeof navigator.connection === 'undefined') {
      add('missing-connection-api', 0.3, false);
    }

    // Check for Notification API permission inconsistency
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'denied' &&
          windowChromeIsMeaningful() && window.outerWidth === 0) {
        add('notification-headless-pattern', 0.5);
      }
    } catch (e) {
      // Ignore errors
    }

    // Phantom.js specific check
    if (window.callPhantom || window._phantom) {
      add('phantomjs', 1.0);
    }

    // Nightmare.js check
    if (window.__nightmare) {
      add('nightmare', 1.0);
    }

    // Increase confidence if multiple indicators are present
    if (indicators.length >= 3) {
      confidence = Math.min(1.0, confidence + 0.2);
    }

    const triggered = indicators.length > 0 &&
      (hasStrongIndicator || confidence >= HeadlessSignal.MIN_TRIGGER_CONFIDENCE);

    return this.createResult(triggered, { indicators }, confidence);
  }
}

export { HeadlessSignal };
