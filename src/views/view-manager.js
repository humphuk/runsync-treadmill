/**
 * Swappable View Engine interface + pure YouTube/Video speed-mapping utilities.
 */

export const YOUTUBE_RATES = Object.freeze([0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0]);

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function nearestYoutubeRate(target) {
  let best = YOUTUBE_RATES[0];
  let bestDiff = Math.abs(target - best);
  for (let i = 1; i < YOUTUBE_RATES.length; i += 1) {
    const diff = Math.abs(target - YOUTUBE_RATES[i]);
    if (diff < bestDiff) {
      best = YOUTUBE_RATES[i];
      bestDiff = diff;
    }
  }
  return best;
}

/**
 * Map live treadmill speed to a video playback rate and play/pause state.
 * Supports smooth continuous scaling (Local MP4) and discrete 0.25x stepping
 * with hysteresis deadbands (YouTube IFrame API).
 *
 * @param {{
 *   speedKph: number,
 *   baseSpeedKph?: number,
 *   currentRate?: number,
 *   mode?: 'discrete' | 'continuous',
 *   hysteresis?: number,
 *   stopThresholdKph?: number,
 *   stoppedSec?: number,
 *   stopDelaySec?: number,
 * }} opts
 * @returns {{ shouldPlay: boolean, rate: number, rawRatio: number }}
 */
export function mapSpeedToPlaybackRate({
  speedKph = 0,
  baseSpeedKph = 10,
  currentRate = 1.0,
  mode = 'discrete',
  hysteresis = 0.035,
  stopThresholdKph = 0.5,
  stoppedSec = 0,
  stopDelaySec = 3.0,
} = {}) {
  const safeBase = Math.max(0.5, Number.isFinite(baseSpeedKph) ? baseSpeedKph : 10);
  const safeSpeed = Math.max(0, Number.isFinite(speedKph) ? speedKph : 0);
  const rawRatio = clamp(safeSpeed / safeBase, 0.25, 2.0);

  if (safeSpeed < stopThresholdKph && stoppedSec >= stopDelaySec) {
    return {
      shouldPlay: false,
      rate: currentRate,
      rawRatio,
    };
  }

  if (mode === 'continuous') {
    return {
      shouldPlay: true,
      rate: Math.round(rawRatio * 100) / 100,
      rawRatio,
    };
  }

  if (!YOUTUBE_RATES.includes(currentRate)) {
    return {
      shouldPlay: true,
      rate: nearestYoutubeRate(rawRatio),
      rawRatio,
    };
  }

  const transitionThreshold = 0.125 + hysteresis;
  const nextRate =
    Math.abs(rawRatio - currentRate) >= transitionThreshold
      ? nearestYoutubeRate(rawRatio)
      : currentRate;

  return {
    shouldPlay: true,
    rate: nextRate,
    rawRatio,
  };
}

/**
 * Extract a YouTube 11-character video ID from standard URLs, Shorts, Embeds, or raw IDs.
 * @param {string} input
 * @returns {string | null}
 */
export function parseYoutubeVideoId(input) {
  if (typeof input !== 'string') {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      const v = url.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) {
        return v;
      }
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && (parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live')) {
        const id = parts[1];
        return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Coordinates switching between swappable view engines (YouTube, Local MP4, future Three.js).
 */
export class ViewManager extends EventTarget {
  constructor(container) {
    super();
    this.container = container;
    this.views = new Map();
    this.activeKey = null;
    this.activeView = null;
    this.muted = true;
    this.baseSpeedKph = 10.0;
    this.manualPaused = false;
  }

  register(key, view) {
    this.views.set(key, view);
  }

  async switchTo(key) {
    const nextView = this.views.get(key);
    if (!nextView) {
      throw new Error(`Unknown view: ${key}`);
    }
    if (this.activeView === nextView) {
      return;
    }
    if (this.activeView) {
      await this.activeView.unmount();
    }
    this.activeKey = key;
    this.activeView = nextView;
    await this.activeView.mount(this.container, {
      muted: this.muted,
      baseSpeedKph: this.baseSpeedKph,
      manualPaused: this.manualPaused,
    });
    this.dispatchEvent(new CustomEvent('viewchange', { detail: { key } }));
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.activeView?.setMuted) {
      this.activeView.setMuted(this.muted);
    }
  }

  setBaseSpeedKph(speedKph) {
    if (typeof speedKph === 'number' && Number.isFinite(speedKph)) {
      this.baseSpeedKph = clamp(speedKph, 3.0, 22.0);
    }
    if (this.activeView?.setBaseSpeedKph) {
      this.activeView.setBaseSpeedKph(this.baseSpeedKph);
    }
  }

  setManualPaused(paused) {
    this.manualPaused = Boolean(paused);
    if (this.activeView?.setManualPaused) {
      this.activeView.setManualPaused(this.manualPaused);
    }
  }

  update(telemetryState, dtSec) {
    if (this.activeView?.update) {
      this.activeView.update(telemetryState, dtSec, {
        baseSpeedKph: this.baseSpeedKph,
        manualPaused: this.manualPaused,
      });
    }
  }
}
