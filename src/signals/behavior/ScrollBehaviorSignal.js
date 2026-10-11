/**
 * @fileoverview Detects non-human scroll patterns.
 */

import { Signal } from '../../core/Signal.js';

/**
 * Tracks and analyzes scroll behavior patterns.
 * Detects programmatic scrolling and non-human scroll patterns.
 *
 * False-positive notes — scroll events are delivered once per animation frame,
 * not once per unit of user input, which invalidates several of the original
 * heuristics:
 *  - `robotic-scroll-timing` measured the variance of the interval between
 *    scroll events. Because those events are frame-quantized, the interval is
 *    ~16.6ms with near-zero jitter for every user of every browser, so this
 *    fired on essentially anyone who scrolled. Removed.
 *  - `no-scroll-momentum` required the scroll velocity to decay. Discrete
 *    mouse-wheel scrolling advances in fixed steps and therefore has no
 *    deceleration phase at all. Removed.
 *  - `exact-position-scrolls` tested `Math.round(scrollY)` against a list of
 *    round numbers. Any user scrolling past 300px passes through 100, 200, 300
 *    and triggers it. Removing the check entirely rather than narrowing it to
 *    the resting position: a mouse wheel advances in 100px notches, so a real
 *    user who stops scrolling comes to rest on a multiple of 100 too.
 *  - A single trackpad flick legitimately moves several hundred pixels in one
 *    frame, so the "instant jump" threshold is now relative to the viewport
 *    and requires a sub-frame time delta.
 */
class ScrollBehaviorSignal extends Signal {
  static id = 'scroll-behavior';
  static category = 'behavior';
  static weight = 0.5;
  static description = 'Detects programmatic scroll patterns';
  static requiresInteraction = true;

  constructor(options = {}) {
    super(options);
    this._scrollEvents = [];
    this._isTracking = false;
    this._trackingDuration = Math.min(options.trackingDuration || 2500, 2500);
    this._boundHandler = null;
  }

  /**
   * Start tracking scroll events.
   */
  startTracking() {
    if (this._isTracking) return;

    this._scrollEvents = [];
    this._isTracking = true;

    this._boundHandler = () => {
      this._scrollEvents.push({
        scrollY: window.scrollY,
        scrollX: window.scrollX,
        t: performance.now(),
      });
    };

    window.addEventListener('scroll', this._boundHandler, { passive: true });
  }

  /**
   * Stop tracking scroll events.
   */
  stopTracking() {
    if (!this._isTracking) return;

    this._isTracking = false;
    if (this._boundHandler) {
      window.removeEventListener('scroll', this._boundHandler);
      this._boundHandler = null;
    }
  }

  async detect() {
    const anomalies = [];
    let confidence = 0;

    // Start tracking if needed
    if (this._scrollEvents.length === 0) {
      this.startTracking();
      await new Promise(resolve => setTimeout(resolve, this._trackingDuration));
      this.stopTracking();
    }

    const events = this._scrollEvents;

    // No scroll events - not necessarily suspicious
    if (events.length < 3) {
      return this.createResult(false, {
        reason: 'insufficient-scroll-data',
        scrollEvents: events.length,
      }, 0);
    }

    const analysis = this._analyzeScrollPatterns(events);

    // Check for instant jumps (scrollTo without animation).
    // A trackpad flick covers hundreds of pixels in a single frame, so this
    // only counts a large displacement inside a sub-frame time delta.
    if (analysis.instantJumps > 0) {
      anomalies.push('instant-scroll-jumps');
      confidence = Math.max(confidence, 0.7);
    }

    // Check for perfectly consistent scroll speed. Judged relative to the
    // average speed: constant *velocity* over many consecutive frames means
    // the page is being scrolled by a timer, not by a hand.
    if (analysis.velocityCV < 0.01 && events.length > 15) {
      anomalies.push('constant-scroll-velocity');
      confidence = Math.max(confidence, 0.6);
    }

    // Check for exclusively vertical or horizontal scroll
    if (analysis.scrollDirections === 1 && Math.abs(analysis.totalScrollY) > 1000) {
      // Could be normal, but combined with other factors is suspicious
      if (analysis.velocityCV < 0.01) {
        anomalies.push('one-dimensional-scroll');
        confidence = Math.max(confidence, 0.4);
      }
    }

    const triggered = anomalies.length > 0;

    return this.createResult(triggered, {
      anomalies,
      scrollEventCount: events.length,
      analysis,
    }, confidence);
  }

  /**
   * Analyze scroll patterns for anomalies.
   * @param {Array} events - Array of scroll events
   * @returns {Object} Analysis results
   */
  _analyzeScrollPatterns(events) {
    if (events.length < 2) {
      return {
        instantJumps: 0,
        velocityVariance: 0,
        velocityCV: 0,
        momentumEvents: 0,
        intervalVariance: 0,
        scrollDirections: 0,
        totalScrollY: 0,
        exactPositionScrolls: 0,
      };
    }

    let instantJumps = 0;
    let momentumEvents = 0;
    const velocities = [];
    const intervals = [];
    let hasVertical = false;
    let hasHorizontal = false;
    let exactPositionScrolls = 0;

    // Common scroll targets (element heights, percentages)
    const commonPositions = [0, 100, 200, 300, 400, 500, 600, 800, 1000];

    // One frame at 60Hz. A displacement this large inside a fraction of a frame
    // cannot come from a wheel or a trackpad.
    const viewportHeight = Math.max(1, window.innerHeight || 0);
    const jumpDistance = Math.max(300, viewportHeight * 0.6);

    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1];
      const curr = events[i];

      const dy = curr.scrollY - prev.scrollY;
      const dx = curr.scrollX - prev.scrollX;
      const dt = curr.t - prev.t;

      intervals.push(dt);

      if (Math.abs(dy) > 0) hasVertical = true;
      if (Math.abs(dx) > 0) hasHorizontal = true;

      if (!(dt > 0)) continue;

      const velocity = Math.sqrt(dy * dy + dx * dx) / dt;
      velocities.push(velocity);

      // Instant jump: large distance in a sub-frame time delta
      const distance = Math.abs(dy) + Math.abs(dx);
      if (distance > jumpDistance && dt < 5) {
        instantJumps++;
      }

      // Momentum: decreasing velocity (natural scroll deceleration)
      if (velocities.length > 1) {
        const prevVelocity = velocities[velocities.length - 2];
        if (velocity < prevVelocity * 0.9 && velocity > 0) {
          momentumEvents++;
        }
      }

      // Passing *through* a round offset is normal; only tracked for
      // diagnostics now, never used as evidence on its own.
      if (commonPositions.includes(Math.round(curr.scrollY))) {
        exactPositionScrolls++;
      }
    }

    // Calculate velocity variance
    const avgVelocity = velocities.length > 0
      ? velocities.reduce((a, b) => a + b, 0) / velocities.length
      : 0;
    const velocityVariance = velocities.length > 0
      ? velocities.reduce((acc, v) => acc + Math.pow(v - avgVelocity, 2), 0) / velocities.length
      : 0;
    const velocityCV = avgVelocity > 0 ? Math.sqrt(velocityVariance) / avgVelocity : 0;

    // Calculate interval variance
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const intervalVariance = intervals.reduce((acc, t) =>
      acc + Math.pow(t - avgInterval, 2), 0) / intervals.length;

    // Count scroll directions
    let scrollDirections = 0;
    if (hasVertical) scrollDirections++;
    if (hasHorizontal) scrollDirections++;

    // Total scroll distance
    const last = events[events.length - 1];
    const totalScrollY = last.scrollY - events[0].scrollY;

    return {
      instantJumps,
      velocityVariance,
      velocityCV,
      momentumEvents,
      intervalVariance,
      scrollDirections,
      totalScrollY,
      exactPositionScrolls,
    };
  }

  reset() {
    super.reset();
    this.stopTracking();
    this._scrollEvents = [];
  }
}

export { ScrollBehaviorSignal };
