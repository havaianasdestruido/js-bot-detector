/**
 * @fileoverview Detects navigator property anomalies and inconsistencies.
 */

import { Signal } from '../../core/Signal.js';
import { getUserAgent, isMobileUA } from '../../core/env.js';

/**
 * Detects inconsistencies in navigator properties.
 * Bots often have mismatched or spoofed navigator values.
 *
 * False-positive notes:
 *  - Windows touch laptops and touchscreen all-in-ones report
 *    `navigator.maxTouchPoints` of 10 while sending a perfectly normal desktop
 *    user agent, so "desktop with many touch points" is not evidence of
 *    automation. Only a *mobile* UA that claims zero touch support is
 *    interesting, because that combination cannot come from a real device.
 *  - Chrome 110+ user-agent reduction returns '' for `navigator.platform` on
 *    Android, which is normal behaviour rather than an anomaly.
 */
class NavigatorAnomalySignal extends Signal {
  static id = 'navigator-anomaly';
  static category = 'environment';
  static weight = 0.7;
  static description = 'Detects navigator property inconsistencies';

  async detect() {
    const anomalies = [];
    let totalScore = 0;
    let checksPerformed = 0;

    const ua = getUserAgent();
    const platform = navigator.platform || '';
    const isMobile = isMobileUA(ua);

    // Platform vs UserAgent consistency check
    checksPerformed++;
    if (platform.includes('Win') && !ua.includes('Windows')) {
      anomalies.push('platform-ua-mismatch-windows');
      totalScore += 1;
    } else if (platform.includes('Mac') && !ua.includes('Mac')) {
      anomalies.push('platform-ua-mismatch-mac');
      totalScore += 1;
    } else if (platform.includes('Linux') && !ua.includes('Linux') && !ua.includes('Android')) {
      anomalies.push('platform-ua-mismatch-linux');
      totalScore += 1;
    }

    // Check for empty or suspicious platform.
    checksPerformed++;
    const isModernChrome = ua.includes('Chrome') && !ua.includes('Chromium');
    if (!isModernChrome && !isMobile && (!platform || platform === '' || platform === 'undefined')) {
      anomalies.push('empty-platform');
      totalScore += 1;
    }

    // Language consistency
    checksPerformed++;
    if (navigator.language && navigator.languages) {
      if (!navigator.languages.includes(navigator.language)) {
        anomalies.push('language-mismatch');
        totalScore += 0.5;
      }
    }

    // Check vendor consistency with browser
    checksPerformed++;
    if (ua.includes('Chrome') && navigator.vendor !== 'Google Inc.') {
      anomalies.push('vendor-mismatch-chrome');
      totalScore += 0.5;
    } else if (ua.includes('Firefox') && navigator.vendor !== '') {
      anomalies.push('vendor-mismatch-firefox');
      totalScore += 0.5;
    } else if (ua.includes('Safari') && !ua.includes('Chrome') &&
               navigator.vendor !== 'Apple Computer, Inc.') {
      anomalies.push('vendor-mismatch-safari');
      totalScore += 0.5;
    }

    // Check for hardwareConcurrency anomaly
    checksPerformed++;
    if (typeof navigator.hardwareConcurrency !== 'undefined') {
      if (navigator.hardwareConcurrency === 0 || navigator.hardwareConcurrency > 128) {
        anomalies.push('suspicious-hardware-concurrency');
        totalScore += 0.5;
      }
    }

    // Check deviceMemory if available
    checksPerformed++;
    if (typeof navigator.deviceMemory !== 'undefined') {
      if (navigator.deviceMemory === 0 || navigator.deviceMemory > 512) {
        anomalies.push('suspicious-device-memory');
        totalScore += 0.5;
      }
    }

    // Check maxTouchPoints consistency.
    // Desktop machines with touchscreens (very common on Windows) report up to
    // 10 touch points, so a high count is normal there. A *mobile* user agent
    // with no touch support, however, cannot come from a real device.
    checksPerformed++;
    const hasTouchPoints = navigator.maxTouchPoints > 0;
    if (isMobile && !hasTouchPoints) {
      anomalies.push('mobile-ua-without-touch');
      totalScore += 0.5;
    }

    // Check for overridden properties (common in spoofing)
    checksPerformed++;
    try {
      const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent');
      if (desc && desc.get && desc.get.toString().includes('native code') === false) {
        anomalies.push('spoofed-user-agent');
        totalScore += 1;
      }
    } catch (e) {
      // Ignore errors
    }

    // Calculate confidence based on number and severity of anomalies
    const triggered = anomalies.length > 0;
    const confidence = Math.min(1, totalScore / Math.max(1, checksPerformed));

    return this.createResult(triggered, { anomalies }, confidence);
  }
}

export { NavigatorAnomalySignal };
