/**
 * @fileoverview Detects permissions API anomalies.
 */

import { Signal } from '../../core/Signal.js';
import { windowChromeIsMeaningful } from '../../core/env.js';

/**
 * Errors that only mean "this browser/context does not implement that
 * permission name". They are thrown by real, healthy browsers and must never
 * be treated as automation evidence:
 *  - `TypeError`       → unknown/unsupported PermissionName (Safari)
 *  - `NotSupportedError` → the name is known but unsupported (Safari, older engines)
 *  - `NotFoundError`   → name not recognised by this implementation
 *  - `NotAllowedError` → blocked by a Permissions-Policy header, which is a
 *                        normal thing for a page inside an iframe to hit
 *  - `SecurityError`   → insecure context
 */
const UNSUPPORTED_ERRORS = new Set([
  'TypeError',
  'NotSupportedError',
  'NotFoundError',
  'NotAllowedError',
  'SecurityError',
]);

/**
 * Detects anomalies in the Permissions API.
 * Automation tools often have inconsistent permission states.
 *
 * False-positive notes:
 *  - Querying an unsupported permission name throws in real browsers, so the
 *    thrown error type must be checked before treating it as evidence.
 *  - A page embedded in an iframe without a `permissions` policy gets
 *    `NotAllowedError`, which is a site configuration issue, not a bot.
 *  - `window.outerWidth === 0` is normal on mobile browsers, so it can only
 *    corroborate a headless finding in a desktop window.
 */
class PermissionsSignal extends Signal {
  static id = 'permissions';
  static category = 'environment';
  static weight = 0.5;
  static description = 'Detects Permissions API anomalies';

  async detect() {
    const anomalies = [];

    // Check if Permissions API exists
    if (!navigator.permissions || typeof navigator.permissions.query !== 'function') {
      // Not an anomaly, just not supported
      return this.createResult(false, { supported: false }, 0);
    }

    try {
      // Check notification permission consistency
      const notificationStatus = await navigator.permissions.query({ name: 'notifications' });

      if (typeof Notification !== 'undefined' && notificationStatus) {
        const directPermission = Notification.permission;

        // Check for mismatch
        if ((directPermission === 'granted' && notificationStatus.state !== 'granted') ||
            (directPermission === 'denied' && notificationStatus.state !== 'denied') ||
            (directPermission === 'default' && notificationStatus.state !== 'prompt')) {
          anomalies.push('notification-permission-mismatch');
        }
      }

      // Check geolocation permission if available
      try {
        const geoStatus = await navigator.permissions.query({ name: 'geolocation' });
        // In automation, geolocation is often pre-denied without user action.
        // A zero-sized window is only suspicious in a desktop browser: mobile
        // browsers report outerWidth/outerHeight of 0 all the time.
        if (geoStatus && geoStatus.state === 'denied' &&
            windowChromeIsMeaningful() && window.outerWidth === 0) {
          anomalies.push('geo-denied-headless');
        }
      } catch (e) {
        // Geolocation permission query may not be supported — not evidence.
      }
    } catch (e) {
      // An error here is only suspicious when it is NOT one of the documented
      // "unsupported in this browser/context" errors.
      if (!UNSUPPORTED_ERRORS.has(e?.name)) {
        anomalies.push('permissions-query-error');
      }
    }

    const triggered = anomalies.length > 0;
    const confidence = Math.min(1, anomalies.length * 0.4);

    return this.createResult(triggered, { anomalies }, confidence);
  }
}

export { PermissionsSignal };
