/**
 * @fileoverview Verdict engine that determines bot/human classification.
 */

/**
 * Possible verdicts from detection.
 * @enum {string}
 */
const Verdict = {
  HUMAN: 'human',
  SUSPICIOUS: 'suspicious',
  BOT: 'bot',
};

/**
 * Determines the final verdict based on score and triggered signals.
 */
class VerdictEngine {
  /**
   * Default threshold configuration.
   * @type {Object}
   */
  static DEFAULT_THRESHOLDS = {
    human: 20,      // score < 20 = human
    suspicious: 50, // 20 <= score < 50 = suspicious
    // score >= 50 = bot
  };

  /**
   * Minimum confidence an instant-bot signal must carry before it is allowed to
   * bypass the score and decide the verdict by itself.
   * @type {number}
   */
  static DEFAULT_INSTANT_BOT_CONFIDENCE = 0.9;

  /**
   * Creates a new VerdictEngine instance.
   * @param {Object} [options={}] - Configuration options
   * @param {number} [options.humanThreshold=20] - Max score for human verdict
   * @param {number} [options.suspiciousThreshold=50] - Max score for suspicious verdict
   * @param {Array<string>} [options.instantBotSignals=[]] - Signal IDs that instantly flag as bot
   * @param {number} [options.instantBotMinConfidence=0.9] - Confidence an instant-bot signal must carry
   */
  constructor(options = {}) {
    this.humanThreshold = options.humanThreshold ?? VerdictEngine.DEFAULT_THRESHOLDS.human;
    this.suspiciousThreshold = options.suspiciousThreshold ?? VerdictEngine.DEFAULT_THRESHOLDS.suspicious;
    this.instantBotSignals = new Set(options.instantBotSignals || []);
    this.instantBotMinConfidence = options.instantBotMinConfidence ??
      VerdictEngine.DEFAULT_INSTANT_BOT_CONFIDENCE;
  }

  /**
   * Get the verdict based on score and triggered signals.
   * @param {number} score - Calculated score (0-100)
   * @param {Array<string>} triggeredSignals - List of triggered signal IDs
   * @param {Object.<string, number>} [signalConfidences] - Confidence per signal ID.
   *   When omitted, triggered signals are assumed to be fully confident, which
   *   keeps the two-argument form of this method backwards compatible.
   * @returns {VerdictResult}
   */
  getVerdict(score, triggeredSignals = [], signalConfidences = null) {
    // A non-finite score (from a malformed signal result) fails every threshold
    // comparison below and would otherwise be silently read as 'bot'.
    const safeScore = Number.isFinite(score) ? score : 0;

    // Check for instant bot signals first.
    //
    // An instant-bot signal short-circuits the whole accumulation model, so it
    // must only do so when it is actually certain. A signal that fired on weak
    // corroboration (for example a default-looking viewport) still contributes
    // to the score like any other signal instead of deciding the verdict on its
    // own.
    for (const signalId of triggeredSignals) {
      if (!this.instantBotSignals.has(signalId)) continue;

      const confidence = signalConfidences && signalId in signalConfidences
        ? signalConfidences[signalId]
        : 1;

      if (confidence >= this.instantBotMinConfidence) {
        return {
          verdict: Verdict.BOT,
          score: safeScore,
          confidence: 'high',
          reason: `Instant bot signal triggered: ${signalId}`,
          triggeredCount: triggeredSignals.length,
        };
      }
    }

    // Score-based verdict
    let verdict;
    let confidence;
    let reason;

    if (safeScore < this.humanThreshold) {
      verdict = Verdict.HUMAN;
      confidence = safeScore < 10 ? 'high' : 'medium';
      reason = 'Low bot score';
    } else if (safeScore < this.suspiciousThreshold) {
      verdict = Verdict.SUSPICIOUS;
      confidence = 'medium';
      reason = 'Moderate bot indicators detected';
    } else {
      verdict = Verdict.BOT;
      confidence = safeScore >= 75 ? 'high' : 'medium';
      reason = 'High accumulation of bot indicators';
    }

    return {
      verdict,
      score: safeScore,
      confidence,
      reason,
      triggeredCount: triggeredSignals.length,
    };
  }

  /**
   * Check if signal should instantly flag as bot.
   * @param {string} signalId - Signal identifier
   * @returns {boolean}
   */
  isInstantBotSignal(signalId) {
    return this.instantBotSignals.has(signalId);
  }

  /**
   * Add a signal to the instant bot list.
   * @param {string} signalId - Signal identifier
   */
  addInstantBotSignal(signalId) {
    this.instantBotSignals.add(signalId);
  }

  /**
   * Update thresholds.
   * @param {Object} thresholds - New threshold values
   * @param {number} [thresholds.human] - New human threshold
   * @param {number} [thresholds.suspicious] - New suspicious threshold
   */
  setThresholds(thresholds) {
    if (thresholds.human !== undefined) {
      this.humanThreshold = thresholds.human;
    }
    if (thresholds.suspicious !== undefined) {
      this.suspiciousThreshold = thresholds.suspicious;
    }
  }
}

/**
 * @typedef {Object} VerdictResult
 * @property {string} verdict - 'human', 'suspicious', or 'bot'
 * @property {number} score - The calculated score
 * @property {string} confidence - 'low', 'medium', or 'high'
 * @property {string} reason - Human-readable reason for verdict
 * @property {number} triggeredCount - Number of triggered signals
 */

export { VerdictEngine, Verdict };
