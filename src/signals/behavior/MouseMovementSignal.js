/**
 * @fileoverview Detects non-human mouse movement patterns.
 */

import { Signal } from '../../core/Signal.js';

/**
 * Tracks and analyzes mouse movement patterns.
 * Bots often have perfectly linear paths or teleporting cursors.
 *
 * False-positive notes:
 *  - "No mouse movement" is not evidence of automation. Touch-device users
 *    never move a mouse, keyboard-only users never touch one, and a human
 *    reading a page for 2.5 seconds may not move it either. The signal now
 *    reports no data instead of triggering.
 *  - Browsers coalesce pointer input into one event per animation frame, so
 *    the raw intervals between the events a page sees are ~16.6ms with almost
 *    no jitter. Measuring "robotic timing" on those frame-quantized events
 *    flagged real users. The raw native samples from
 *    `PointerEvent.getCoalescedEvents()` are used when available, and the
 *    timing check is skipped when they are not.
 *  - A human moving the cursor to a button in a straight line produces a very
 *    high angle-consistency score, so linearity alone no longer triggers: it
 *    must be paired with an inhumanly constant speed.
 */
class MouseMovementSignal extends Signal {
  static id = 'mouse-movement';
  static category = 'behavior';
  static weight = 0.9;
  static description = 'Detects non-human mouse movement patterns';
  static requiresInteraction = true;

  constructor(options = {}) {
    super(options);
    this._movements = [];
    this._isTracking = false;
    this._trackingDuration = Math.min(options.trackingDuration || 2500, 2500);
    this._minMovements = options.minMovements || 5;
    this._boundHandler = null;
    this._eventType = MouseMovementSignal._preferredEventType();
    // When the browser cannot hand us the raw input samples, the intervals we
    // observe are dictated by the frame rate rather than by the user, and no
    // timing conclusion can be drawn from them.
    this._inputMayBeFrameQuantized = !MouseMovementSignal._supportsCoalescedEvents();
  }

  /**
   * Whether PointerEvent with coalesced-event support is available.
   * @returns {boolean}
   * @private
   */
  static _supportsCoalescedEvents() {
    try {
      return typeof window !== 'undefined' &&
        typeof window.PointerEvent === 'function' &&
        typeof window.PointerEvent.prototype.getCoalescedEvents === 'function';
    } catch (e) {
      return false;
    }
  }

  /**
   * Pointer events carry the raw native samples, mouse events do not.
   * @returns {string} The DOM event type to listen for.
   * @private
   */
  static _preferredEventType() {
    try {
      return typeof window !== 'undefined' && typeof window.PointerEvent === 'function'
        ? 'pointermove'
        : 'mousemove';
    } catch (e) {
      return 'mousemove';
    }
  }

  /**
   * Record a single movement sample.
   * @param {number} x - Viewport X coordinate.
   * @param {number} y - Viewport Y coordinate.
   * @param {number} t - Timestamp (ms since navigation start).
   * @private
   */
  _record(x, y, t) {
    if (typeof x !== 'number' || typeof y !== 'number' || Number.isNaN(x) || Number.isNaN(y)) {
      return;
    }
    this._movements.push({ x, y, t });
  }

  /**
   * Start tracking mouse movements.
   * @returns {void}
   */
  startTracking() {
    if (this._isTracking) return;

    this._movements = [];
    this._isTracking = true;

    this._boundHandler = (e) => {
      // Synthetic events dispatched by page scripts are not user input and
      // must not be counted as human behaviour.
      if (e.isTrusted === false) return;

      // Expand the raw native samples when the browser gives them to us.
      let coalesced = null;
      if (typeof e.getCoalescedEvents === 'function') {
        try {
          coalesced = e.getCoalescedEvents();
        } catch (err) {
          coalesced = null;
        }
      }

      if (coalesced && coalesced.length > 0) {
        this._inputMayBeFrameQuantized = false;
        for (const sample of coalesced) {
          this._record(sample.clientX, sample.clientY, this._timestampOf(sample));
        }
        return;
      }

      this._record(e.clientX, e.clientY, this._timestampOf(e));
    };

    document.addEventListener(this._eventType, this._boundHandler, { passive: true });
  }

  /**
   * Resolve the timestamp of an input event, falling back to the clock.
   * @param {Event} e - The input event.
   * @returns {number}
   * @private
   */
  _timestampOf(e) {
    const ts = e && e.timeStamp;
    if (typeof ts === 'number' && ts > 0 && ts <= performance.now() + 1000) {
      return ts;
    }
    return performance.now();
  }

  /**
   * Stop tracking mouse movements.
   */
  stopTracking() {
    if (!this._isTracking) return;

    this._isTracking = false;
    if (this._boundHandler) {
      document.removeEventListener(this._eventType, this._boundHandler);
      this._boundHandler = null;
    }
  }

  async detect() {
    const anomalies = [];
    let confidence = 0;

    // If no tracking has occurred, check if we have movement data
    if (this._movements.length === 0) {
      // Start tracking for a period, then analyze
      this.startTracking();

      await new Promise(resolve => setTimeout(resolve, this._trackingDuration));

      this.stopTracking();
    }

    const movements = this._movements;

    // Not enough mouse movement to analyse anything. This is the normal state
    // for touch-device and keyboard users, so it is reported as "no data"
    // rather than as a bot indicator.
    if (movements.length < this._minMovements) {
      return this.createResult(false, {
        reason: 'insufficient-mouse-data',
        movements: movements.length,
      }, 0);
    }

    // Analyze movement patterns
    const analysis = this._analyzeMovements(movements);

    // Check for teleportation (large instant jumps). 300px in under 5ms is
    // far beyond any physical mouse, but comfortably above a fast flick.
    if (analysis.teleportCount > 0) {
      anomalies.push('mouse-teleportation');
      confidence = Math.max(confidence, 0.7);
    }

    // Check for perfectly linear paths. Humans move in straight lines all the
    // time (cursor to button), so linearity only counts when the speed is
    // also machine-constant across the whole path.
    if (analysis.linearPathRatio > 0.95 && analysis.velocityCV < 0.05) {
      anomalies.push('linear-path');
      confidence = Math.max(confidence, 0.8);
    }

    // Check for constant velocity (too perfect). Expressed relative to the
    // average speed so slow and fast movements are judged the same way.
    if (analysis.velocityCV < 0.02 && movements.length > 10) {
      anomalies.push('constant-velocity');
      confidence = Math.max(confidence, 0.7);
    }

    // Check for zero acceleration changes (needs a real sample count to mean
    // anything — a single swipe that decelerates monotonically has none).
    if (analysis.accelerationChanges === 0 && movements.length > 25) {
      anomalies.push('no-acceleration-variance');
      confidence = Math.max(confidence, 0.6);
    }

    // Check for robotic timing (perfect intervals). Only meaningful when the
    // browser hands us the raw input samples instead of one event per frame.
    if (!this._inputMayBeFrameQuantized && analysis.timingCV < 0.02 && movements.length > 10) {
      anomalies.push('robotic-timing');
      confidence = Math.max(confidence, 0.8);
    }

    const triggered = anomalies.length > 0;

    return this.createResult(triggered, {
      anomalies,
      movementCount: movements.length,
      analysis,
    }, confidence);
  }

  /**
   * Analyze movement patterns for anomalies.
   * @param {Array} movements - Array of movement points
   * @returns {Object} Analysis results
   */
  _analyzeMovements(movements) {
    if (movements.length < 3) {
      return {
        teleportCount: 0,
        linearPathRatio: 0,
        velocityVariance: 0,
        velocityCV: 0,
        accelerationChanges: 0,
        timingVariance: 0,
        timingCV: 0,
      };
    }

    let teleportCount = 0;
    const velocities = [];
    const angles = [];
    const timeIntervals = [];

    for (let i = 1; i < movements.length; i++) {
      const prev = movements[i - 1];
      const curr = movements[i];

      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      const dt = curr.t - prev.t;

      if (!(dt > 0)) continue;

      const distance = Math.sqrt(dx * dx + dy * dy);
      const velocity = distance / dt;

      velocities.push(velocity);
      angles.push(Math.atan2(dy, dx));
      timeIntervals.push(dt);

      // Teleportation: large jump in a time window no physical device covers
      if (distance > 300 && dt < 5) {
        teleportCount++;
      }
    }

    if (velocities.length === 0) {
      return {
        teleportCount,
        linearPathRatio: 0,
        velocityVariance: 0,
        velocityCV: 0,
        accelerationChanges: 0,
        timingVariance: 0,
        timingCV: 0,
      };
    }

    // Calculate velocity variance
    const avgVelocity = velocities.reduce((a, b) => a + b, 0) / velocities.length;
    const velocityVariance = velocities.reduce((acc, v) =>
      acc + Math.pow(v - avgVelocity, 2), 0) / velocities.length;
    // Coefficient of variation: scale-free, so a slow straight move and a fast
    // one are not judged differently.
    const velocityCV = avgVelocity > 0 ? Math.sqrt(velocityVariance) / avgVelocity : 0;

    // Calculate angle consistency (linear path detection)
    let angleConsistency = 0;
    if (angles.length > 1) {
      let consistentAngles = 0;
      for (let i = 1; i < angles.length; i++) {
        const angleDiff = Math.abs(angles[i] - angles[i - 1]);
        if (angleDiff < 0.1) consistentAngles++;
      }
      angleConsistency = consistentAngles / (angles.length - 1);
    }

    // Calculate timing variance
    const avgInterval = timeIntervals.reduce((a, b) => a + b, 0) / timeIntervals.length;
    const timingVariance = timeIntervals.reduce((acc, t) =>
      acc + Math.pow(t - avgInterval, 2), 0) / timeIntervals.length;
    const timingCV = avgInterval > 0 ? Math.sqrt(timingVariance) / avgInterval : 0;

    // Count acceleration changes (sign changes of the velocity delta).
    // Starts at index 2 so the window is always fully populated.
    let accelerationChanges = 0;
    for (let i = 2; i < velocities.length; i++) {
      const deltaNow = velocities[i] - velocities[i - 1];
      const deltaPrev = velocities[i - 1] - velocities[i - 2];
      if (deltaNow * deltaPrev < 0) {
        accelerationChanges++;
      }
    }

    return {
      teleportCount,
      linearPathRatio: angleConsistency,
      velocityVariance,
      velocityCV,
      accelerationChanges,
      timingVariance,
      timingCV,
    };
  }

  reset() {
    super.reset();
    this.stopTracking();
    this._movements = [];
  }
}

export { MouseMovementSignal };
