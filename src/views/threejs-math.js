/**
 * Pure math, palette definitions, incline pitch, camera stride-bob,
 * scrolling wrap, milestone arch tracking, and Ghost Pacer helpers
 * for the Phase 2A Three.js 3D Runner.
 */

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

export const WORLD_THEMES = Object.freeze({
  forest: Object.freeze({
    key: 'forest',
    label: 'Forest Trail',
    skyTop: '#0d1b2a',
    skyHorizon: '#355c7d',
    fogColor: '#3c5e75',
    ambientColor: '#9db4c0',
    sunColor: '#ffe4a3',
    sunDiscColor: '#fff2cc',
    terrainPrimary: '#24472f',
    terrainSecondary: '#1b3624',
    roadBase: '#2b303a',
    roadStripe: '#e2e8f0',
    roadShoulder: '#64748b',
    trunkColor: '#5c4033',
    canopyColor: '#2d6a4f',
    canopyAltColor: '#40916c',
    propColor: '#6b7280',
    archColor: '#38bdf8',
    ghostColor: '#38bdf8',
  }),
  coastal: Object.freeze({
    key: 'coastal',
    label: 'Coastal Sunset',
    skyTop: '#1e1b4b',
    skyHorizon: '#f97316',
    fogColor: '#c26d5c',
    ambientColor: '#f5b895',
    sunColor: '#ffbe76',
    sunDiscColor: '#ffd166',
    terrainPrimary: '#b59268',
    terrainSecondary: '#0e7490',
    roadBase: '#4a3b32',
    roadStripe: '#fef3c7',
    roadShoulder: '#d6b384',
    trunkColor: '#6b4f3a',
    canopyColor: '#2a7b6f',
    canopyAltColor: '#3b9b82',
    propColor: '#fbbf24',
    archColor: '#fb923c',
    ghostColor: '#34d399',
  }),
  synthwave: Object.freeze({
    key: 'synthwave',
    label: 'Synthwave Grid',
    skyTop: '#090314',
    skyHorizon: '#6b1d68',
    fogColor: '#2d0f42',
    ambientColor: '#a855f7',
    sunColor: '#f43f5e',
    sunDiscColor: '#fb7185',
    terrainPrimary: '#130726',
    terrainSecondary: '#06b6d4',
    roadBase: '#110d24',
    roadStripe: '#22d3ee',
    roadShoulder: '#ec4899',
    trunkColor: '#312e81',
    canopyColor: '#22d3ee',
    canopyAltColor: '#f472b6',
    propColor: '#c084fc',
    archColor: '#f472b6',
    ghostColor: '#22d3ee',
  }),
});

/**
 * Convert treadmill incline % into exaggerated visual pitch angle (radians)
 * so road climbs and descents read clearly in 3D.
 * Positive pitch lifts the -Z horizon upward.
 * @param {number} inclinePct
 * @returns {number}
 */
export function computeInclinePitchRad(inclinePct = 0) {
  const safe = Number.isFinite(inclinePct) ? clamp(inclinePct, -5, 20) : 0;
  return Math.atan((safe / 100) * 1.45);
}

/**
 * Compute road height Y at distance zAheadM ahead of the runner.
 * @param {number} zAheadM
 * @param {number} inclinePct
 * @returns {number}
 */
export function computeRoadYAtZ(zAheadM, inclinePct = 0) {
  if (!Number.isFinite(zAheadM) || zAheadM <= 0) {
    return 0;
  }
  return zAheadM * Math.tan(computeInclinePitchRad(inclinePct));
}

/**
 * Subtle cadence-synced camera bob offset when enabled and moving.
 * @param {number} phaseRad
 * @param {number} speedKph
 * @param {boolean} enabled
 * @returns {{ x: number, y: number }}
 */
export function computeStrideBobOffset(phaseRad, speedKph, enabled = true) {
  if (!enabled || !Number.isFinite(speedKph) || speedKph < 0.5) {
    return { x: 0, y: 0 };
  }
  const scale = clamp((speedKph - 0.5) / 10, 0.15, 1.0);
  return {
    x: Math.cos(phaseRad) * 0.016 * scale,
    y: Math.sin(phaseRad * 2) * 0.042 * scale,
  };
}

/**
 * Wrap a scrolling Z coordinate cleanly within [nearZ - spanM, nearZ].
 * @param {number} z
 * @param {number} deltaZ
 * @param {number} [spanM=240]
 * @param {number} [nearZ=18]
 * @returns {number}
 */
export function wrapScrollZ(z, deltaZ, spanM = 240, nearZ = 18) {
  let next = z + deltaZ;
  const farZ = nearZ - spanM;
  while (next > nearZ) {
    next -= spanM;
  }
  while (next < farZ) {
    next += spanM;
  }
  return next;
}

/**
 * Return the next milestone arch distance strictly greater than distanceM.
 * @param {number} distanceM
 * @param {number} [intervalM=500]
 * @returns {number}
 */
export function computeNextArchDistanceM(distanceM = 0, intervalM = 500) {
  const safeInterval = Math.max(50, intervalM || 500);
  const safeDist = Math.max(0, Number.isFinite(distanceM) ? distanceM : 0);
  return (Math.floor(safeDist / safeInterval) + 1) * safeInterval;
}

/**
 * Compute Ghost Pacer world position and live ahead/behind gap.
 * Positive gapM means ghost is ahead of the runner (in -Z direction).
 *
 * @param {{
 *   runnerDistanceM?: number,
 *   targetPaceSecPerKm?: number,
 *   elapsedSec?: number,
 *   enabled?: boolean,
 * }} opts
 * @returns {{
 *   enabled: boolean,
 *   ghostSpeedMps: number,
 *   ghostDistanceM: number,
 *   gapM: number,
 *   gapSec: number,
 *   visibleInRange: boolean,
 *   zOffset: number,
 * }}
 */
export function updateGhostPacer({
  runnerDistanceM = 0,
  targetPaceSecPerKm = 330,
  elapsedSec = 0,
  enabled = false,
} = {}) {
  const clampedPace = clamp(Number.isFinite(targetPaceSecPerKm) ? targetPaceSecPerKm : 330, 150, 600);
  const ghostSpeedMps = 1000 / clampedPace;
  const safeElapsed = Math.max(0, Number.isFinite(elapsedSec) ? elapsedSec : 0);
  const safeRunner = Math.max(0, Number.isFinite(runnerDistanceM) ? runnerDistanceM : 0);
  const ghostDistanceM = enabled ? ghostSpeedMps * safeElapsed : 0;
  const gapM = ghostDistanceM - safeRunner;
  const gapSec = gapM / ghostSpeedMps;
  const visibleInRange = Boolean(enabled) && Math.abs(gapM) <= 185;
  const zOffset = -gapM;

  return {
    enabled: Boolean(enabled),
    ghostSpeedMps,
    ghostDistanceM,
    gapM,
    gapSec,
    visibleInRange,
    zOffset,
  };
}
