/**
 * @fileoverview Detects Puppeteer-specific artifacts.
 */

import { Signal } from '../../core/Signal.js';

/**
 * Detects artifacts left by Puppeteer automation.
 * Puppeteer leaves various fingerprints in the browser context.
 *
 * False-positive notes:
 *  - `HeadlessChrome` in the user agent belongs to `HeadlessSignal`; repeating
 *    it here double-counted the same evidence across two instant-bot signals.
 *  - Scanning `Error().stack` for the word "puppeteer" matched the *page URL*
 *    and the URLs of the page's own scripts, so a real human visiting a site
 *    whose URL contains "puppeteer" (for example pptr.dev) was instantly
 *    classified as a bot. An error thrown by this library never contains the
 *    automation framework's name, so the check could only ever produce false
 *    positives and has been removed.
 *  - An 800x600 viewport is Puppeteer's default, but it is also a real window
 *    size, so it is kept only as weak corroboration.
 */
class PuppeteerSignal extends Signal {
  static id = 'puppeteer';
  static category = 'automation';
  static weight = 1.0;
  static description = 'Detects Puppeteer automation artifacts';

  /** Confidence floor required before this signal reports `triggered`. */
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

    // Check for Puppeteer-injected globals.
    // `__puppeteer_evaluation_script__` and `__puppeteer` are unambiguous
    // Puppeteer markers; a plain `puppeteer` global is only ever present on
    // pages that bundle the library itself.
    const puppeteerGlobals = [
      '__puppeteer_evaluation_script__',
      '__puppeteer',
    ];

    for (const global of puppeteerGlobals) {
      if (global in window) {
        add(`global-${global}`, 1.0);
      }
    }

    // Check for Puppeteer's typical Chrome DevTools Protocol artifacts
    if (window.cdc_adoQpoasnfa76pfcZLmcfl_Array ||
        window.cdc_adoQpoasnfa76pfcZLmcfl_Promise ||
        window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol) {
      add('cdp-artifacts', 1.0);
    }

    // Check for Puppeteer's default viewport (800x600).
    // Weak on its own — real users run 800x600 windows too, so it only ever
    // corroborates a stronger Puppeteer finding.
    if (window.innerWidth === 800 && window.innerHeight === 600) {
      add('default-viewport', 0.3, false);
    }

    // navigator.webdriver is already exclusively checked by WebDriverSignal (environment).
    // Duplicating it here causes triple-counting of the same property across signals.
    // `HeadlessChrome` in the user agent is exclusively checked by HeadlessSignal.

    // Check for binding injection pattern
    // Puppeteer's exposeFunction creates window bindings
    // (Next.js, webpack, React DevTools, Angular) push __* count past the
    // old threshold of 5 on perfectly normal pages.
    const FRAMEWORK_PREFIXES = [
      '__zone_symbol__',   // Angular / Zone.js
      '__next',            // Next.js
      '__webpack',         // webpack
      '__react',           // React DevTools
      '__REACT',
      '__vite',            // Vite
      '__nuxt',            // Nuxt.js
    ];
    const suspiciousBindings = Object.keys(window).filter(key => {
      if (!key.startsWith('__')) return false;
      if (typeof window[key] !== 'function') return false;
      return !FRAMEWORK_PREFIXES.some(prefix => key.startsWith(prefix));
    });

    if (suspiciousBindings.length > 10) {
      add('suspicious-bindings', 0.5);
    }

    // window.chrome.runtime is ONLY populated inside Chrome extensions.
    // Its absence is completely normal for all real Chrome users.
    // This check was causing every non-extension Chrome user to be flagged as Puppeteer.

    const triggered = indicators.length > 0 &&
      (hasStrongIndicator || confidence >= PuppeteerSignal.MIN_TRIGGER_CONFIDENCE);

    return this.createResult(triggered, { indicators }, confidence);
  }
}

export { PuppeteerSignal };
