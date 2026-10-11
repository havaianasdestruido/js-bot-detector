/**
 * @fileoverview Detects AudioContext anomalies.
 */

import { Signal } from '../../core/Signal.js';

/**
 * Checks for AudioContext anomalies.
 * Bots and headless browsers often have unusual or missing audio capabilities.
 *
 * False-positive notes:
 *  - The sample rate follows whatever output device the user has selected. A
 *    Bluetooth headset commonly reports 16000, 24000 or 32000 Hz, so anything
 *    outside 44100/48000/96000 used to flag real users wearing headphones.
 *    Only a non-numeric or zero rate is suspicious now.
 *  - A mono destination is the expected result of the OS-level "play stereo
 *    audio as mono" accessibility setting, not evidence of automation, so that
 *    check has been removed.
 *  - A missing AudioContext is weak evidence: privacy extensions and locked-down
 *    enterprise browsers remove it from real users too.
 */
class AudioContextSignal extends Signal {
  static id = 'audio-context';
  static category = 'fingerprint';
  static weight = 0.5;
  static description = 'Detects AudioContext anomalies';

  async detect() {
    const anomalies = [];
    let confidence = 0;

    // Check if AudioContext exists
    const AudioContext = window.AudioContext || window.webkitAudioContext;

    if (!AudioContext) {
      // AudioContext not available
      anomalies.push('audio-context-unavailable');
      confidence = Math.max(confidence, 0.3);
      return this.createResult(true, { anomalies }, confidence);
    }

    let audioContext = null;
    let oscillator = null;
    let analyser = null;

    try {
      audioContext = new AudioContext();

      // Check sample rate. The rate mirrors the user's output device (a
      // Bluetooth headset reports 16/24/32kHz), so only an impossible value is
      // worth reporting.
      const sampleRate = audioContext.sampleRate;
      if (typeof sampleRate !== 'number' || !(sampleRate > 0)) {
        anomalies.push('invalid-sample-rate');
        confidence = Math.max(confidence, 0.4);
      }

      // Try to create an oscillator and check its properties
      oscillator = audioContext.createOscillator();
      analyser = audioContext.createAnalyser();

      if (!oscillator || !analyser) {
        anomalies.push('audio-nodes-unavailable');
        confidence = Math.max(confidence, 0.5);
      } else {
        // Check destination
        const destination = audioContext.destination;
        if (!destination || destination.maxChannelCount === 0) {
          anomalies.push('no-audio-destination');
          confidence = Math.max(confidence, 0.6);
        }
      }

      // Check for overridden AudioContext
      try {
        const audioCtxStr = AudioContext.toString();
        if (!audioCtxStr.includes('[native code]')) {
          anomalies.push('audio-context-overridden');
          confidence = Math.max(confidence, 0.7);
        }
      } catch (e) {
        // Some environments may throw
      }

      // Audio fingerprint test - create a noise signal and check output
      try {
        if (audioContext.state === 'suspended') {
          // Try to resume (may not work without user gesture)
          await audioContext.resume().catch(() => {});
        }

        // Only perform if we can
        if (audioContext.state === 'running') {
          const oscillatorNode = audioContext.createOscillator();
          const gainNode = audioContext.createGain();
          const scriptProcessor = audioContext.createScriptProcessor
            ? audioContext.createScriptProcessor(4096, 1, 1)
            : null;

          if (scriptProcessor) {
            oscillatorNode.type = 'triangle';
            oscillatorNode.frequency.value = 10000;
            gainNode.gain.value = 0;

            oscillatorNode.connect(gainNode);
            gainNode.connect(scriptProcessor);
            scriptProcessor.connect(audioContext.destination);

            // Brief test
            oscillatorNode.start(0);

            await new Promise(resolve => setTimeout(resolve, 50));

            oscillatorNode.stop();
            oscillatorNode.disconnect();
            gainNode.disconnect();
            scriptProcessor.disconnect();
          }
        }
      } catch (e) {
        // Audio fingerprinting blocked or failed
        anomalies.push('audio-fingerprint-blocked');
        confidence = Math.max(confidence, 0.4);
      }

      // Check for OfflineAudioContext
      const OfflineAudioContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OfflineAudioContext) {
        anomalies.push('offline-audio-context-unavailable');
        confidence = Math.max(confidence, 0.3);
      }

    } catch (e) {
      anomalies.push('audio-context-error');
      confidence = Math.max(confidence, 0.4);
    } finally {
      // Clean up
      if (oscillator) {
        try { oscillator.disconnect(); } catch (e) {}
      }
      if (analyser) {
        try { analyser.disconnect(); } catch (e) {}
      }
      if (audioContext) {
        // close() is async and rejects when the context is already closed, so
        // the returned promise must be swallowed rather than left unhandled.
        try {
          Promise.resolve(audioContext.close()).catch(() => {});
        } catch (e) {}
      }
    }

    const triggered = anomalies.length > 0;

    return this.createResult(triggered, { anomalies }, confidence);
  }
}

export { AudioContextSignal };
