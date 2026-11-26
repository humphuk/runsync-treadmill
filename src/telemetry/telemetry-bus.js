/**
 * Unified telemetry bus normalizing sensor inputs (RunPod, HR Strap, Sim, future FTMS),
 * applying calibration and time-aware EMA smoothing, integrating run distance/elevation,
 * and computing pace and heart-rate zones.
 */

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

/**
 * Convert speed in km/h to pace in seconds per kilometre.
 * Returns null if speed is below 0.5 km/h.
 * @param {number} speedKph
 * @returns {number | null}
 */
export function computePaceSecPerKm(speedKph) {
  if (typeof speedKph !== 'number' || !Number.isFinite(speedKph) || speedKph < 0.5) {
    return null;
  }
  return 3600 / speedKph;
}

/**
 * Format pace (sec/km) as `M:SS`.
 * @param {number | null} secPerKm
 * @returns {string}
 */
export function formatPace(secPerKm) {
  if (typeof secPerKm !== 'number' || !Number.isFinite(secPerKm) || secPerKm <= 0) {
    return '--:--';
  }
  const rounded = Math.round(secPerKm);
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Format duration in seconds as `MM:SS` or `H:MM:SS`.
 * @param {number} totalSec
 * @returns {string}
 */
export function formatDuration(totalSec) {
  const s = Math.max(0, Math.floor(totalSec || 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Classify heart rate into standard 5-zone percentages of Max HR.
 * @param {number | null} bpm
 * @param {number} [maxHr=180]
 * @returns {{ zone: number, label: string, pct: number } | null}
 */
export function computeHrZone(bpm, maxHr = 180) {
  if (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm <= 0) {
    return null;
  }
  const safeMax = Math.max(100, maxHr || 180);
  const pct = Math.round((bpm / safeMax) * 100);
  if (pct < 60) {
    return { zone: 1, label: 'Z1 Recovery', pct };
  }
  if (pct < 70) {
    return { zone: 2, label: 'Z2 Aerobic', pct };
  }
  if (pct < 80) {
    return { zone: 3, label: 'Z3 Tempo', pct };
  }
  if (pct < 90) {
    return { zone: 4, label: 'Z4 Threshold', pct };
  }
  return { zone: 5, label: 'Z5 VO2Max', pct };
}

export class TelemetryBus extends EventTarget {
  /**
   * @param {{
   *   calibrationFactor?: number,
   *   emaTauSec?: number,
   *   maxHr?: number,
   * }} [options]
   */
  constructor({ calibrationFactor = 1.0, emaTauSec = 3.5, maxHr = 180 } = {}) {
    super();
    this._calibrationFactor = clamp(calibrationFactor, 0.7, 1.35);
    this._emaTauSec = clamp(emaTauSec, 0.5, 10.0);
    this._maxHr = clamp(maxHr, 120, 220);

    this.state = {
      rawSpeedMps: 0,
      speedMps: 0,
      speedKph: 0,
      smoothedSpeedKph: 0,
      paceSecPerKm: null,
      cadenceSpm: null,
      inclinePct: 0,
      heartRateBpm: null,
      distanceM: 0,
      elevationGainM: 0,
      elapsedSec: 0,
      stoppedSec: 0,
      isMoving: false,
      source: 'idle',
      calibrationFactor: this._calibrationFactor,
      recordingState: 'idle', // 'idle' | 'running' | 'paused' | 'finished'
    };
  }

  getSnapshot() {
    return { ...this.state };
  }

  setCalibrationFactor(factor) {
    if (typeof factor !== 'number' || !Number.isFinite(factor)) {
      return this._calibrationFactor;
    }
    this._calibrationFactor = clamp(factor, 0.7, 1.35);
    this.state.calibrationFactor = this._calibrationFactor;
    this._recomputeSpeed();
    this._emitUpdate();
    return this._calibrationFactor;
  }

  setEmaTauSec(tauSec) {
    if (typeof tauSec === 'number' && Number.isFinite(tauSec)) {
      this._emaTauSec = clamp(tauSec, 0.5, 10.0);
    }
  }

  setMaxHr(maxHr) {
    if (typeof maxHr === 'number' && Number.isFinite(maxHr)) {
      this._maxHr = clamp(maxHr, 120, 220);
    }
  }

  setInclinePct(inclinePct) {
    if (typeof inclinePct !== 'number' || !Number.isFinite(inclinePct)) {
      return;
    }
    this.state.inclinePct = Math.round(clamp(inclinePct, -5, 20) * 10) / 10;
    this._emitUpdate();
  }

  adjustInclinePct(delta) {
    this.setInclinePct(this.state.inclinePct + delta);
    return this.state.inclinePct;
  }

  /**
   * Calibrate RunPod multiplier directly against the Roger Black console speed display.
   * @param {number} actualTreadmillKph
   * @returns {number | null}
   */
  syncToTreadmillSpeed(actualTreadmillKph) {
    const rawKph = this.state.rawSpeedMps * 3.6;
    if (
      typeof actualTreadmillKph !== 'number' ||
      !Number.isFinite(actualTreadmillKph) ||
      actualTreadmillKph <= 0.5 ||
      rawKph <= 0.5
    ) {
      return null;
    }
    return this.setCalibrationFactor(actualTreadmillKph / rawKph);
  }

  /**
   * Ingest a speed/cadence reading from RunPod, Sim, or future FTMS.
   * @param {{
   *   speedMps: number,
   *   cadenceSpm?: number | null,
   *   inclinePct?: number | null,
   *   source?: string,
   *   applyCalibration?: boolean,
   * }} reading
   */
  ingestSpeed({
    speedMps,
    cadenceSpm = null,
    inclinePct = null,
    source = 'rsc',
    applyCalibration = true,
  }) {
    if (typeof speedMps !== 'number' || !Number.isFinite(speedMps) || speedMps < 0) {
      return;
    }
    this.state.rawSpeedMps = speedMps;
    this.state.source = source;
    if (cadenceSpm !== null && Number.isFinite(cadenceSpm)) {
      this.state.cadenceSpm = Math.max(0, Math.round(cadenceSpm));
    }
    if (inclinePct !== null && Number.isFinite(inclinePct)) {
      this.state.inclinePct = Math.round(clamp(inclinePct, -5, 20) * 10) / 10;
    }
    this._recomputeSpeed(applyCalibration);
  }

  /**
   * Ingest a heart-rate measurement.
   * @param {{ bpm: number | null }} reading
   */
  ingestHeartRate({ bpm }) {
    if (bpm === null || bpm === undefined) {
      this.state.heartRateBpm = null;
      return;
    }
    if (typeof bpm === 'number' && Number.isFinite(bpm) && bpm > 0) {
      this.state.heartRateBpm = Math.round(bpm);
    }
  }

  setRecordingState(nextState) {
    this.state.recordingState = nextState;
    this._emitUpdate();
  }

  resetRun() {
    this.state.distanceM = 0;
    this.state.elevationGainM = 0;
    this.state.elapsedSec = 0;
    this.state.recordingState = 'idle';
    this._emitUpdate();
  }

  /**
   * Advance EMA smoothing, stopped-duration timer, and distance/elevation integration.
   * @param {number} dtSec
   */
  step(dtSec) {
    if (typeof dtSec !== 'number' || !Number.isFinite(dtSec) || dtSec <= 0) {
      return this.getSnapshot();
    }
    const dt = Math.min(dtSec, 1.0);

    const alpha = 1 - Math.exp(-dt / this._emaTauSec);
    this.state.smoothedSpeedKph += (this.state.speedKph - this.state.smoothedSpeedKph) * alpha;
    if (this.state.speedKph === 0 && this.state.smoothedSpeedKph < 0.05) {
      this.state.smoothedSpeedKph = 0;
    }

    if (this.state.speedKph < 0.5) {
      this.state.stoppedSec += dt;
      this.state.isMoving = false;
    } else {
      this.state.stoppedSec = 0;
      this.state.isMoving = true;
    }

    if (this.state.recordingState === 'running') {
      this.state.elapsedSec += dt;
      const stepDistM = this.state.speedMps * dt;
      this.state.distanceM += stepDistM;
      if (this.state.inclinePct > 0 && stepDistM > 0) {
        this.state.elevationGainM += stepDistM * (this.state.inclinePct / 100);
      }
    }

    this._emitUpdate();
    return this.getSnapshot();
  }

  _recomputeSpeed(applyCalibration = true) {
    const mult = applyCalibration ? this._calibrationFactor : 1.0;
    this.state.speedMps = this.state.rawSpeedMps * mult;
    this.state.speedKph = this.state.speedMps * 3.6;
    this.state.paceSecPerKm = computePaceSecPerKm(this.state.speedKph);
  }

  _emitUpdate() {
    this.dispatchEvent(new CustomEvent('update', { detail: this.getSnapshot() }));
  }
}
