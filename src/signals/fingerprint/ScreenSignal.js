/**
 * @fileoverview Detects unusual screen and window dimensions.
 */

import { Signal } from '../../core/Signal.js';
import { getUserAgent, isMobileUA, windowChromeIsMeaningful } from '../../core/env.js';

/**
 * Detects screen dimension anomalies.
 * Bots and headless browsers often have unusual screen configurations.
 *
 * False-positive notes:
 *  - Mobile browsers report `window.outerWidth/outerHeight` of 0 (Firefox for
 *    Android always does) and legitimately have `inner === outer`, because
 *    there is no window furniture to subtract. Those checks now only run in a
 *    desktop window that is not fullscreen or an installed PWA.
 *  - Browser zoom multiplies `devicePixelRatio`: 25% zoom on a 1x display gives
 *    0.25 and 500% zoom on a retina display gives 10. The old 0.5–5 range
 *    flagged both. Only a missing/zero ratio is reported now.
 *  - A window can legitimately be wider than `window.screen` when it spans two
 *    monitors, and `screen.availHeight` can exceed `screen.height` on some
 *    mobile shells, so both checks now require a large, unexplainable excess.
 *  - 1920x1080 was listed as a "headless default" resolution. It is the most
 *    common desktop resolution there is, and a user in F11 fullscreen matches
 *    the check exactly. Removed.
 */
class ScreenSignal extends Signal {
  static id = 'screen';
  static category = 'fingerprint';
  static weight = 0.4;
  static description = 'Detects unusual screen dimensions';

  async detect() {
    const anomalies = [];
    let confidence = 0;

    const screen = window.screen;
    if (!screen) {
      anomalies.push('no-screen-object');
      confidence = Math.max(confidence, 0.6);
      return this.createResult(true, { anomalies }, confidence);
    }

    const width = screen.width;
    const height = screen.height;
    const availWidth = screen.availWidth;
    const availHeight = screen.availHeight;
    const colorDepth = screen.colorDepth;
    const pixelDepth = screen.pixelDepth;
    const outerWidth = window.outerWidth;
    const outerHeight = window.outerHeight;
    const innerWidth = window.innerWidth;
    const innerHeight = window.innerHeight;

    const ua = getUserAgent();
    const isMobile = isMobileUA(ua);
    // Whether outer/inner relationships carry any meaning in this environment.
    const chromeMeaningful = windowChromeIsMeaningful();

    // Check for zero dimensions (headless indicator)
    if (chromeMeaningful && outerWidth === 0 && outerHeight === 0) {
      anomalies.push('zero-outer-dimensions');
      confidence = Math.max(confidence, 0.8);
    }

    if (innerWidth === 0 || innerHeight === 0) {
      anomalies.push('zero-inner-dimensions');
      confidence = Math.max(confidence, 0.7);
    }

    // Check for very small screen (unrealistic for desktop)
    if (!isMobile && (width < 640 || height < 480)) {
      anomalies.push('very-small-screen');
      confidence = Math.max(confidence, 0.5);
    }

    // Check for very large screen (unrealistic)
    if (width > 7680 || height > 4320) { // Beyond 8K
      anomalies.push('unrealistic-screen-size');
      confidence = Math.max(confidence, 0.4);
    }

    // Check for common headless default dimensions. 1920x1080 is deliberately
    // not in this list — see class notes.
    const headlessDefaults = [
      { w: 800, h: 600 },
      { w: 1024, h: 768 },
    ];

    if (chromeMeaningful) {
      for (const def of headlessDefaults) {
        if (width === def.w && height === def.h &&
            outerWidth === def.w && outerHeight === def.h) {
          // Exact match with no browser chrome - suspicious
          anomalies.push('headless-default-dimensions');
          confidence = Math.max(confidence, 0.5);
          break;
        }
      }
    }

    // Check for screen larger than available (impossible). A small rounding
    // difference is normal on mobile shells and when the taskbar auto-hides.
    if (!isMobile && (availWidth - width > 100 || availHeight - height > 100)) {
      anomalies.push('available-exceeds-total');
      confidence = Math.max(confidence, 0.7);
    }

    // Check for window larger than screen. Multi-monitor spanning legitimately
    // produces this, so only a large excess counts.
    if (!isMobile && (outerWidth > width * 1.25 || outerHeight > height * 1.25)) {
      anomalies.push('window-exceeds-screen');
      confidence = Math.max(confidence, 0.6);
    }

    // Check for an absent colour depth. Any real display reports one; the exact
    // value varies with HDR panels and OS settings, so it is not judged.
    if (!colorDepth) {
      anomalies.push('missing-color-depth');
      confidence = Math.max(confidence, 0.3);
    }

    // Check for mismatched color/pixel depth
    if (colorDepth !== pixelDepth) {
      anomalies.push('depth-mismatch');
      confidence = Math.max(confidence, 0.3);
    }

    // Check for device pixel ratio anomalies. Only a missing/zero ratio is
    // impossible; the range check removed because browser zoom owns it.
    const dpr = window.devicePixelRatio;
    if (!dpr || dpr === 0) {
      anomalies.push('missing-device-pixel-ratio');
      confidence = Math.max(confidence, 0.5);
    }

    // Check for screen orientation API anomalies. Only a large contradiction
    // counts: some mobile WebViews keep screen.width/height portrait-locked
    // while reporting a landscape orientation.
    if (screen.orientation && typeof screen.orientation.type === 'string') {
      const orientationType = screen.orientation.type;
      const delta = Math.abs(width - height);

      if (delta > 100) {
        if (orientationType.includes('landscape') && width < height) {
          anomalies.push('orientation-dimension-mismatch');
          confidence = Math.max(confidence, 0.4);
        } else if (orientationType.includes('portrait') && width > height) {
          anomalies.push('orientation-dimension-mismatch');
          confidence = Math.max(confidence, 0.4);
        }
      }
    }

    // Check for innerWidth/Height being exactly equal to outer (no browser
    // chrome) — only meaningful in a windowed desktop browser.
    if (chromeMeaningful &&
        innerWidth === outerWidth && innerHeight === outerHeight &&
        outerWidth > 0 && outerHeight > 0) {
      anomalies.push('no-browser-chrome');
      confidence = Math.max(confidence, 0.5);
    }

    const triggered = anomalies.length > 0;

    return this.createResult(triggered, {
      anomalies,
      dimensions: {
        screen: { width, height },
        available: { width: availWidth, height: availHeight },
        window: { outer: { width: outerWidth, height: outerHeight },
                  inner: { width: innerWidth, height: innerHeight } },
        colorDepth,
        devicePixelRatio: dpr,
      },
    }, confidence);
  }
}

export { ScreenSignal };
