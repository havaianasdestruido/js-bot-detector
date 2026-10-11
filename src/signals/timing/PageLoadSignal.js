/**
 * @fileoverview Detects suspicious page load timing patterns.
 */

import { Signal } from '../../core/Signal.js';
import { isCacheRestoredNavigation } from '../../core/env.js';

/**
 * Analyzes page load timing for automation indicators.
 * Bots often have unusual or suspiciously fast load patterns.
 *
 * False-positive notes:
 *  - Back/forward-cache restores and prerendered documents report near-zero
 *    navigation timings. They are a normal way for a real user to arrive at a
 *    page, so timing analysis is skipped for them entirely.
 *  - A warm TCP connection (keep-alive, service worker, HTTP/2 reuse) reports
 *    zero DNS and zero connect time, and a fast CDN answers in a few
 *    milliseconds. "Zero network timing" therefore only counts when the whole
 *    document also parsed impossibly fast.
 *  - `instant-script-execution` fired whenever the HTML finished arriving less
 *    than 5ms before DOMContentLoaded, which is what every small cached page
 *    does. Removed.
 *  - Clock-consistency sampling used to compare two calls that bracketed
 *    nothing, so a garbage-collection pause between them looked like a spoofed
 *    clock. The drift is now measured over a nested window and the smallest of
 *    three samples is used.
 *  - The `performance.now()` liveness probe busy-waited until the clock moved.
 *    On browsers with a deliberately coarse clock (Tor Browser reduces timer
 *    precision to 100ms) that could block the main thread for that long, so the
 *    spin is capped and the check is skipped when the cap is reached.
 */
class PageLoadSignal extends Signal {
  static id = 'page-load';
  static category = 'timing';
  static weight = 0.5;
  static description = 'Detects suspicious page load timing';

  /** Upper bound on the clock-liveness spin loop. */
  static SPIN_ITERATION_LIMIT = 50000;

  async detect() {
    const anomalies = [];
    let confidence = 0;

    // A bfcache restore or a prerender reports near-zero timings that would be
    // read as automation. Nothing about them is suspicious.
    if (isCacheRestoredNavigation()) {
      return this.createResult(false, { reason: 'restored-navigation' }, 0);
    }

    // Check if Performance API is available
    if (!window.performance || !performance.timing) {
      // Try Navigation Timing API Level 2
      if (performance.getEntriesByType) {
        const navEntries = performance.getEntriesByType('navigation');
        if (navEntries.length > 0) {
          return this._analyzeNavigationTiming(navEntries[0]);
        }
      }

      anomalies.push('no-performance-api');
      confidence = Math.max(confidence, 0.3);
      return this.createResult(true, { anomalies }, confidence);
    }

    const timing = performance.timing;

    // Calculate key timings.
    // A 0 entry means the event hasn't fired; subtracting from a large epoch
    // timestamp produces a huge negative number that was incorrectly flagged
    // as 'negative-timing' (timestamp manipulation).
    const navigationStart = timing.navigationStart;
    const safeTimingDiff = (end, start) => {
      if (end === 0 || start === 0) return null;
      return end - start;
    };

    const domContentLoaded = safeTimingDiff(timing.domContentLoadedEventEnd, navigationStart);
    const domComplete = safeTimingDiff(timing.domComplete, navigationStart);
    const loadComplete = safeTimingDiff(timing.loadEventEnd, navigationStart);
    const dnsLookup = safeTimingDiff(timing.domainLookupEnd, timing.domainLookupStart);
    const tcpConnection = safeTimingDiff(timing.connectEnd, timing.connectStart);
    const serverResponse = safeTimingDiff(timing.responseEnd, timing.requestStart);
    const domProcessing = safeTimingDiff(timing.domComplete, timing.domLoading);

    // The document parsed in no time at all — the only genuinely impossible
    // case, and the anchor for the "warm connection" check below.
    const impossibleLoad = domContentLoaded !== null &&
      domContentLoaded > 0 && domContentLoaded < 10;

    if (impossibleLoad) {
      anomalies.push('instant-dom-content-loaded');
      confidence = Math.max(confidence, 0.7);
    }

    // Zero DNS/TCP time is what a reused connection looks like, so it only
    // counts together with an impossible parse time.
    if (dnsLookup === 0 && tcpConnection === 0 &&
        serverResponse !== null && serverResponse < 5 && impossibleLoad) {
      anomalies.push('zero-network-timing');
      confidence = Math.max(confidence, 0.4);
    }

    // Check for negative timings (timestamp manipulation).
    if ((domContentLoaded !== null && domContentLoaded < 0) ||
        (domComplete !== null && domComplete < 0) ||
        (loadComplete !== null && loadComplete < 0)) {
      anomalies.push('negative-timing');
      confidence = Math.max(confidence, 0.8);
    }

    // Check for unrealistic timing order
    if (timing.domContentLoadedEventEnd > 0 && timing.loadEventEnd > 0) {
      if (timing.domContentLoadedEventEnd > timing.loadEventEnd) {
        anomalies.push('timing-order-violation');
        confidence = Math.max(confidence, 0.7);
      }
    }

    // Check for very long processing times (could indicate headless waiting)
    if (domProcessing !== null && domProcessing > 30000) { // 30 seconds
      anomalies.push('excessive-dom-processing');
      confidence = Math.max(confidence, 0.3);
    }

    // Check for performance.now() manipulation.
    // Browsers quantize performance.now() to 1-2ms for Spectre protection (and
    // to 100ms in hardened privacy browsers), so two consecutive calls can
    // legitimately return the same value. Spin to force the clock past its
    // granularity first, but bail out if it never moves so a coarse clock does
    // not stall the main thread.
    const perfBefore = performance.now();
    const spinEnd = perfBefore + 2;
    let iterations = 0;
    while (performance.now() < spinEnd && iterations < PageLoadSignal.SPIN_ITERATION_LIMIT) {
      iterations++;
    }
    const perfAfter = performance.now();

    if (iterations < PageLoadSignal.SPIN_ITERATION_LIMIT && perfAfter === perfBefore) {
      // Clock truly didn't advance over 2ms — something is wrong
      anomalies.push('frozen-performance-now');
      confidence = Math.max(confidence, 0.6);
    }

    // Check Date.now() vs performance.now() consistency. The Date window is
    // nested inside the performance window, so any divergence beyond timer
    // resolution means one of the clocks is being manipulated. A single sample
    // is not trustworthy (a GC pause looks identical), so keep the smallest.
    let minClockDrift = Infinity;
    for (let i = 0; i < 3; i++) {
      const dateNow1 = Date.now();
      const perfNow = performance.now();
      const dateNow2 = Date.now();
      const perfNow2 = performance.now();
      const drift = Math.abs((dateNow2 - dateNow1) - (perfNow2 - perfNow));
      if (drift < minClockDrift) minClockDrift = drift;
    }

    if (minClockDrift > 100) {
      anomalies.push('timing-inconsistency');
      confidence = Math.max(confidence, 0.5);
    }

    const triggered = anomalies.length > 0;

    return this.createResult(triggered, {
      anomalies,
      timings: {
        domContentLoaded,
        domComplete,
        loadComplete,
        dnsLookup,
        tcpConnection,
        serverResponse,
        domProcessing,
      },
    }, confidence);
  }

  /**
   * Analyze Navigation Timing Level 2 API data.
   * @param {PerformanceNavigationTiming} entry - Navigation timing entry
   * @returns {SignalResult}
   */
  _analyzeNavigationTiming(entry) {
    const anomalies = [];
    let confidence = 0;

    // Restored/prerendered navigations have no meaningful network timings.
    if (entry.type === 'back_forward' || entry.type === 'prerender') {
      return this.createResult(false, { reason: 'restored-navigation' }, 0);
    }

    const domContentLoaded = entry.domContentLoadedEventEnd;
    const loadComplete = entry.loadEventEnd;
    const dnsLookup = entry.domainLookupEnd - entry.domainLookupStart;
    const serverResponse = entry.responseEnd - entry.requestStart;

    // Check for impossibly fast load
    const impossibleLoad = domContentLoaded > 0 && domContentLoaded < 10;
    if (impossibleLoad) {
      anomalies.push('instant-dom-content-loaded');
      confidence = Math.max(confidence, 0.7);
    }

    // Zero DNS/response time alone is just a warm connection or a cache hit.
    if (dnsLookup === 0 && serverResponse === 0 && impossibleLoad) {
      anomalies.push('zero-network-timing');
      confidence = Math.max(confidence, 0.4);
    }

    const triggered = anomalies.length > 0;

    return this.createResult(triggered, {
      anomalies,
      timings: {
        domContentLoaded,
        loadComplete,
        dnsLookup,
        serverResponse,
      },
    }, confidence);
  }
}

export { PageLoadSignal };
