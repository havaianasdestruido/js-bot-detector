/**
 * @fileoverview Detects browser plugin anomalies.
 */

import { Signal } from '../../core/Signal.js';
import { getUserAgent, isMobileUA, isChromiumUA } from '../../core/env.js';

/**
 * Checks for empty or suspicious plugin configurations.
 * Headless browsers and bots often have no plugins.
 *
 * False-positive notes:
 *  - Mobile browsers expose no plugin list at all: Android Chrome and iOS
 *    Safari both report `navigator.plugins.length === 0`, so an empty list is
 *    only meaningful on a desktop browser.
 *  - A single plugin on desktop is a legitimate configuration (a hardened
 *    Firefox with the Widevine CDM disabled, for example), so it is no longer
 *    treated as evidence.
 *  - Two plugins sharing a name is not enough to call the list spoofed; only a
 *    list that is *entirely* one repeated name is.
 */
class PluginsSignal extends Signal {
  static id = 'plugins';
  static category = 'fingerprint';
  static weight = 0.6;
  static description = 'Detects browser plugin anomalies';

  async detect() {
    const anomalies = [];
    let confidence = 0;

    const plugins = navigator.plugins;
    const mimeTypes = navigator.mimeTypes;
    const ua = getUserAgent();
    const isMobile = isMobileUA(ua);

    // Check if plugins exists
    if (!plugins) {
      anomalies.push('no-plugins-object');
      confidence = Math.max(confidence, 0.6);
      return this.createResult(true, { anomalies }, confidence);
    }

    // Check for empty plugins array.
    // Only meaningful on desktop Chromium, where a genuine Chrome always ships
    // its built-in PDF plugin entries. Mobile browsers expose no plugin list at
    // all, and Safari/Firefox legitimately report an empty or near-empty list
    // depending on the user's DRM and plugin settings.
    if (!isMobile && isChromiumUA(ua) && plugins.length === 0) {
      anomalies.push('empty-plugins');
      confidence = Math.max(confidence, 0.5);
    }

    // Check for Chrome-specific plugins in Chrome browser
    if (!isMobile && isChromiumUA(ua)) {
      // Real Chrome typically has at least these plugins
      const hasChromePdf = Array.from(plugins).some(p =>
        p.name.includes('PDF') || p.name.includes('Chromium PDF'));

      if (!hasChromePdf && plugins.length === 0) {
        anomalies.push('chrome-missing-pdf-plugin');
        confidence = Math.max(confidence, 0.4);
      }
    }

    // Check for consistent plugin/mimeType relationship
    if (plugins.length > 0 && mimeTypes) {
      let totalMimeTypes = 0;
      for (let i = 0; i < plugins.length; i++) {
        totalMimeTypes += plugins[i].length || 0;
      }

      // Plugins exist but no mimeTypes
      if (mimeTypes.length === 0 && totalMimeTypes > 0) {
        anomalies.push('mimetypes-mismatch');
        confidence = Math.max(confidence, 0.5);
      }
    }

    // Check for identical plugin names (sign of spoofing).
    // A real browser can legitimately report two entries with the same name,
    // so only a list made up entirely of one repeated name counts.
    if (plugins.length > 2) {
      const names = Array.from(plugins).map(p => p.name);
      const uniqueNames = new Set(names);
      if (uniqueNames.size === 1) {
        anomalies.push('duplicate-plugins');
        confidence = Math.max(confidence, 0.6);
      }
    }

    // Check for plugin array tampering
    try {
      const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'plugins');
      if (desc && desc.get) {
        // Check if it's been overridden
        const nativeToString = desc.get.toString();
        if (!nativeToString.includes('[native code]')) {
          anomalies.push('plugins-getter-overridden');
          confidence = Math.max(confidence, 0.7);
        }
      }
    } catch (e) {
      // Ignore errors during introspection
    }

    const triggered = anomalies.length > 0;

    return this.createResult(triggered, {
      anomalies,
      pluginCount: plugins.length,
      mimeTypeCount: mimeTypes?.length || 0,
    }, confidence);
  }
}

export { PluginsSignal };
