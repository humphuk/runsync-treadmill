/**
 * Optional Web Speech API voice coach for 1 km splits and future Phase 2B incline prompts.
 */

import { formatDuration, formatPace } from '../telemetry/telemetry-bus.js';

export class VoiceCoach {
  constructor({ enabled = false, splitMeters = 1000 } = {}) {
    this.enabled = Boolean(enabled);
    this.splitMeters = splitMeters;
    this._nextSplitM = splitMeters;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled && typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }

  reset(currentDistanceM = 0) {
    const completedSplits = Math.floor(Math.max(0, currentDistanceM) / this.splitMeters);
    this._nextSplitM = (completedSplits + 1) * this.splitMeters;
  }

  announce(text) {
    if (!this.enabled || typeof window === 'undefined' || !window.speechSynthesis) {
      return;
    }
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    } catch {
      // Ignore speech synthesis errors on unsupported browsers.
    }
  }

  onTelemetry(state) {
    if (!this.enabled || state.recordingState !== 'running') {
      return;
    }
    if (state.distanceM >= this._nextSplitM) {
      const km = Math.round(this._nextSplitM / 1000);
      this._nextSplitM += this.splitMeters;
      const paceText = state.paceSecPerKm
        ? `${formatPace(state.paceSecPerKm).replace(':', ' minutes ')} seconds per kilometre`
        : 'steady pace';
      const hrText = state.heartRateBpm ? `, heart rate ${state.heartRateBpm}` : '';
      this.announce(
        `${km} kilometre${km === 1 ? '' : 's'} completed in ${formatDuration(state.elapsedSec)}. Pace ${paceText}${hrText}.`,
      );
    }
  }
}
