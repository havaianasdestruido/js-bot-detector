/**
 * @fileoverview Detects non-human keyboard input patterns.
 */

import { Signal } from '../../core/Signal.js';
import { isMobileUA, hasTouchSupport } from '../../core/env.js';

/**
 * Keys produced by IME composition / soft keyboards. They arrive without a
 * reliable keyup, so they are excluded from hold-time and missing-keyup
 * analysis.
 */
const IME_KEYS = new Set(['Unidentified', 'Process', '']);

/**
 * Analyzes keystroke timing patterns.
 * Bots often type with unnatural consistency or inhuman speeds.
 *
 * False-positive notes:
 *  - Auto-repeat: holding a key (backspace, an arrow key, a game control)
 *    produces a stream of `keydown` events with no matching `keyup`, at a
 *    perfectly regular cadence. Those events used to be counted as real
 *    keystrokes, which made a human holding one key look like an inhuman
 *    typist with "missing keyups". Repeats are now ignored.
 *  - Keyup pairing used `Array.find()` on the whole keyup list, so repeated
 *    keys were matched against the wrong keyup and produced bogus hold times.
 *    Downs and ups are now paired FIFO per key code.
 *  - Soft keyboards and IMEs (Android Gboard, CJK input) legitimately emit
 *    keydown events with no keyup and with `key === 'Unidentified'`, so the
 *    missing-keyup check is skipped on touch devices and for composed input.
 */
class KeyboardPatternSignal extends Signal {
  static id = 'keyboard-pattern';
  static category = 'behavior';
  static weight = 0.8;
  static description = 'Detects non-human keystroke patterns';
  static requiresInteraction = true;

  constructor(options = {}) {
    super(options);
    this._keystrokes = [];
    this._isTracking = false;
    this._trackingDuration = Math.min(options.trackingDuration || 2500, 2500);
    this._minKeystrokes = options.minKeystrokes || 10;
    this._boundKeydownHandler = null;
    this._boundKeyupHandler = null;
  }

  /**
   * Start tracking keyboard events.
   */
  startTracking() {
    if (this._isTracking) return;

    this._keystrokes = [];
    this._isTracking = true;

    this._boundKeydownHandler = (e) => {
      if (e.isTrusted === false) return;
      this._keystrokes.push({
        type: 'down',
        key: e.key,
        code: e.code,
        repeat: e.repeat === true,
        t: performance.now(),
      });
    };

    this._boundKeyupHandler = (e) => {
      if (e.isTrusted === false) return;
      this._keystrokes.push({
        type: 'up',
        key: e.key,
        code: e.code,
        repeat: false,
        t: performance.now(),
      });
    };

    document.addEventListener('keydown', this._boundKeydownHandler, { passive: true });
    document.addEventListener('keyup', this._boundKeyupHandler, { passive: true });
  }

  /**
   * Stop tracking keyboard events.
   */
  stopTracking() {
    if (!this._isTracking) return;

    this._isTracking = false;
    if (this._boundKeydownHandler) {
      document.removeEventListener('keydown', this._boundKeydownHandler);
      this._boundKeydownHandler = null;
    }
    if (this._boundKeyupHandler) {
      document.removeEventListener('keyup', this._boundKeyupHandler);
      this._boundKeyupHandler = null;
    }
  }

  async detect() {
    const anomalies = [];
    let confidence = 0;

    // If no tracking has occurred, start it
    if (this._keystrokes.length === 0) {
      this.startTracking();
      await new Promise(resolve => setTimeout(resolve, this._trackingDuration));
      this.stopTracking();
    }

    const keystrokes = this._keystrokes;
    // Auto-repeat events are the OS repeating one held key, not new keystrokes.
    const keydowns = keystrokes.filter(k => k.type === 'down' && !k.repeat);

    // No keyboard activity
    if (keydowns.length < this._minKeystrokes) {
      // Not necessarily a bot - could just be no typing needed
      return this.createResult(false, {
        reason: 'insufficient-data',
        keystrokes: keydowns.length
      }, 0);
    }

    const analysis = this._analyzeKeystrokes(keystrokes);

    // Check for inhuman typing speed (> 20 chars/second sustained)
    if (analysis.avgInterKeystrokeTime < 50 && keydowns.length > 20) {
      anomalies.push('inhuman-speed');
      confidence = Math.max(confidence, 0.9);
    }

    // Check for too-consistent timing (robotic)
    if (analysis.timingVariance < 5 && keydowns.length > 15) {
      anomalies.push('robotic-timing');
      confidence = Math.max(confidence, 0.8);
    }

    // Check for missing key-up events (programmatic input).
    // Soft keyboards, IME composition and focus loss all swallow keyup events
    // in real browsers, so this is only judged on devices with a physical
    // keyboard and only for keys that report a usable identity.
    if (analysis.missingKeyups > analysis.analysableKeydowns * 0.5 &&
        analysis.analysableKeydowns > 5 && analysis.keyupDeliveryReliable) {
      anomalies.push('missing-keyups');
      confidence = Math.max(confidence, 0.7);
    }

    // Check for perfect key hold times
    if (analysis.holdTimeVariance < 2 && analysis.holdTimes.length > 10) {
      anomalies.push('constant-hold-time');
      confidence = Math.max(confidence, 0.6);
    }

    // Check for sequential key codes (batch input)
    if (analysis.sequentialKeys > keydowns.length * 0.8 && keydowns.length > 10) {
      anomalies.push('sequential-input');
      confidence = Math.max(confidence, 0.5);
    }

    // Check for no typing rhythm variation
    if (analysis.rhythmScore < 0.1 && keydowns.length > 20) {
      anomalies.push('no-rhythm-variation');
      confidence = Math.max(confidence, 0.6);
    }

    const triggered = anomalies.length > 0;

    return this.createResult(triggered, {
      anomalies,
      keystrokeCount: keydowns.length,
      analysis,
    }, confidence);
  }

  /**
   * Analyze keystroke patterns.
   * @param {Array} keystrokes - Array of keystroke events
   * @returns {Object} Analysis results
   */
  _analyzeKeystrokes(keystrokes) {
    const keydowns = keystrokes.filter(k => k.type === 'down' && !k.repeat);

    const empty = {
      avgInterKeystrokeTime: Infinity,
      timingVariance: Infinity,
      missingKeyups: 0,
      analysableKeydowns: 0,
      keyupDeliveryReliable: false,
      holdTimeVariance: Infinity,
      holdTimes: [],
      sequentialKeys: 0,
      rhythmScore: 1,
    };

    if (keydowns.length < 2) {
      return empty;
    }

    // Calculate inter-keystroke times
    const interTimes = [];
    for (let i = 1; i < keydowns.length; i++) {
      interTimes.push(keydowns[i].t - keydowns[i - 1].t);
    }

    const avgInterKeystrokeTime = interTimes.reduce((a, b) => a + b, 0) / interTimes.length;
    const timingVariance = interTimes.reduce((acc, t) =>
      acc + Math.pow(t - avgInterKeystrokeTime, 2), 0) / interTimes.length;

    // Pair each keydown with the next keyup of the same key, FIFO, so that a
    // held or repeated key never steals another key's keyup event.
    const holdTimes = [];
    const pending = new Map();
    for (const event of keystrokes) {
      if (event.repeat) continue;
      const identity = event.code || event.key || '';
      if (event.type === 'down') {
        const queue = pending.get(identity) || [];
        queue.push(event.t);
        pending.set(identity, queue);
      } else {
        const queue = pending.get(identity);
        if (queue && queue.length > 0) {
          const downTime = queue.shift();
          if (event.t >= downTime) {
            holdTimes.push(event.t - downTime);
          }
        }
      }
    }

    // Only keys with a real identity can be judged for keyup delivery: IME and
    // soft-keyboard input reports 'Unidentified'/'Process' with no keyup.
    const analysable = keydowns.filter(k => !IME_KEYS.has(k.key) && !IME_KEYS.has(k.code));
    const keyupDeliveryReliable = !isMobileUA() && !hasTouchSupport();

    const avgHoldTime = holdTimes.length > 0
      ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length
      : 0;
    const holdTimeVariance = holdTimes.length > 0
      ? holdTimes.reduce((acc, t) => acc + Math.pow(t - avgHoldTime, 2), 0) / holdTimes.length
      : Infinity;

    // Count missing keyups among analysable keystrokes only
    const missingKeyups = Math.max(0, analysable.length - holdTimes.length);

    // Count sequential keys (chars typed in order, like 'abc' or '123')
    let sequentialKeys = 0;
    for (let i = 1; i < keydowns.length; i++) {
      const prevCode = (keydowns[i - 1].key || '').charCodeAt(0);
      const currCode = (keydowns[i].key || '').charCodeAt(0);
      if (!Number.isNaN(prevCode) && !Number.isNaN(currCode) &&
          Math.abs(currCode - prevCode) === 1) {
        sequentialKeys++;
      }
    }

    // Calculate typing rhythm score (variation in timing patterns)
    // Humans have natural rhythm variations (pause after words, faster for common patterns)
    let rhythmScore = 0;
    if (interTimes.length > 5) {
      const sortedTimes = [...interTimes].sort((a, b) => a - b);
      const median = sortedTimes[Math.floor(sortedTimes.length / 2)];
      // Count how many timings deviate significantly from median
      const deviations = median > 0
        ? interTimes.filter(t => Math.abs(t - median) > median * 0.3).length
        : 0;
      rhythmScore = deviations / interTimes.length;
    }

    return {
      avgInterKeystrokeTime,
      timingVariance,
      missingKeyups,
      analysableKeydowns: analysable.length,
      keyupDeliveryReliable,
      holdTimeVariance,
      holdTimes,
      sequentialKeys,
      rhythmScore,
    };
  }

  reset() {
    super.reset();
    this.stopTracking();
    this._keystrokes = [];
  }
}

export { KeyboardPatternSignal };
