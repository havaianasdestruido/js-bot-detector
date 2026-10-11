/**
 * @fileoverview Analyzes DOM content loaded event timing.
 */

import { Signal } from '../../core/Signal.js';
import { isHiddenPage } from '../../core/env.js';

/**
 * Analyzes timing around DOMContentLoaded event.
 * Bots may have unusual patterns in when/how DOM is processed.
 *
 * False-positive notes:
 *  - `instant-dom-operations` compared the duration of an appendChild/removeChild
 *    pair against zero. `performance.now()` is quantized to 1ms in Firefox and
 *    Safari and to 100µs in Chrome, and the pair completes faster than that, so
 *    both measurements came back 0 for real browsers. Removed.
 *  - `hidden-at-load` flagged every user who opened the link in a background
 *    tab (Ctrl/Cmd+click, middle-click), which is ordinary behaviour and not
 *    what a headless browser looks like. Removed.
 *  - Paint timing: a hidden/background page never paints, and Safari does not
 *    implement the Paint Timing API at all while Firefox emits no `first-paint`
 *    entry. The FCP check now runs only where the API exists and the page is
 *    visible, and the `first-paint` check has been dropped.
 */
class DOMContentTimingSignal extends Signal {
  static id = 'dom-content-timing';
  static category = 'timing';
  static weight = 0.4;
  static description = 'Analyzes DOM content loaded timing patterns';

  constructor(options = {}) {
    super(options);
    this._domContentLoadedTime = null;
    this._documentReadyState = document.readyState;
    this._captureTime = performance.now();

    // Capture DOMContentLoaded time if not already loaded
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        this._domContentLoadedTime = performance.now();
      });
    }
  }

  async detect() {
    const anomalies = [];
    let confidence = 0;

    // Get timing information
    const now = performance.now();
    const readyState = document.readyState;

    // Check resource timing
    let resourceCount = 0;
    let totalResourceTime = 0;
    let externalScriptCount = 0;

    if (performance.getEntriesByType) {
      const resources = performance.getEntriesByType('resource');
      resourceCount = resources.length;

      for (const resource of resources) {
        totalResourceTime += resource.duration;
        if (resource.initiatorType === 'script' &&
            resource.name.startsWith('http')) {
          externalScriptCount++;
        }
      }
    }

    // Check for very few resources. Weak: a single-file page, or one served
    // entirely from a service worker cache, legitimately loads nothing extra.
    if (resourceCount === 0 && readyState === 'complete') {
      anomalies.push('no-resources-loaded');
      confidence = Math.max(confidence, 0.3);
    }

    // Check for suspiciously fast DOM ready without resources
    if (this._domContentLoadedTime && this._domContentLoadedTime < 50 && resourceCount === 0) {
      anomalies.push('instant-ready-no-resources');
      confidence = Math.max(confidence, 0.6);
    }

    // Check for visibility API
    if (typeof document.visibilityState === 'undefined') {
      anomalies.push('no-visibility-api');
      confidence = Math.max(confidence, 0.4);
    }

    // Check for a DOM that cannot be mutated (mocked document).
    try {
      const randomId = `__bdt_${Math.random().toString(36).slice(2)}`;
      const testDiv = document.createElement('div');
      testDiv.id = randomId;
      document.body.appendChild(testDiv);
      const appended = document.getElementById(randomId) === testDiv;
      document.body.removeChild(testDiv);

      // Only a DOM that does not actually reflect the mutation is suspicious;
      // how long it took is meaningless under timer quantization.
      if (!appended) {
        anomalies.push('dom-mutation-not-reflected');
        confidence = Math.max(confidence, 0.5);
      }
    } catch (e) {
      // If body doesn't exist yet, that's unusual at detection time
      if (!document.body) {
        anomalies.push('no-document-body');
        confidence = Math.max(confidence, 0.4);
      }
    }

    // Check for MutationObserver availability (should exist in modern browsers)
    if (typeof MutationObserver === 'undefined') {
      anomalies.push('no-mutation-observer');
      confidence = Math.max(confidence, 0.5);
    }

    // Check for requestAnimationFrame availability
    if (typeof requestAnimationFrame === 'undefined') {
      anomalies.push('no-request-animation-frame');
      confidence = Math.max(confidence, 0.5);
    }

    // Check timing of first contentful paint. A hidden page never paints, and
    // not every engine implements Paint Timing, so both are ruled out first.
    if (performance.getEntriesByType && !isHiddenPage() &&
        typeof window.PerformancePaintTiming === 'function') {
      const paintEntries = performance.getEntriesByType('paint');

      const fcp = paintEntries.find(e => e.name === 'first-contentful-paint');
      if (!fcp && readyState === 'complete' && now > 1000) {
        anomalies.push('no-first-contentful-paint');
        confidence = Math.max(confidence, 0.4);
      }
    }

    // Check intersection observer
    if (typeof IntersectionObserver === 'undefined') {
      anomalies.push('no-intersection-observer');
      confidence = Math.max(confidence, 0.4);
    }

    const triggered = anomalies.length > 0;

    return this.createResult(triggered, {
      anomalies,
      metrics: {
        readyState,
        resourceCount,
        externalScriptCount,
        domContentLoadedTime: this._domContentLoadedTime,
        documentHidden: document.hidden,
      },
    }, confidence);
  }
}

export { DOMContentTimingSignal };
