/**
 * Pure math, palette definitions, quality presets, incline pitch, camera stride-bob,
 * scrolling wrap, milestone arch tracking, and Ghost Pacer helpers
 * for the Phase 2A Three.js 3D Runner.
 */

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

export const QUALITY_PRESETS = Object.freeze({
  low: Object.freeze({
    key: 'low',
    label: 'Low (Battery / Max FPS)',
    maxDpr: 0.85,
    antialias: false,
    shadows: false,
    shadowMapSize: 0,
    sceneryCount: 110,
    grassCount: 0,
    cloudCount: 0,
    particleCount: 0,
    terrainSegX: 24,
    terrainSegZ: 18,
    farClip: 220,
    fogNear: 55,
    fogFar: 205,
    useStandardMaterials: false,
  }),
  medium: Object.freeze({
    key: 'medium',
    label: 'Medium (Lenovo Duet)',
    maxDpr: 1.25,
    antialias: true,
    shadows: false,
    shadowMapSize: 0,
    sceneryCount: 200,
    grassCount: 140,
    cloudCount: 14,
    particleCount: 0,
    terrainSegX: 40,
    terrainSegZ: 28,
    farClip: 285,
    fogNear: 75,
    fogFar: 265,
    useStandardMaterials: true,
  }),
  high: Object.freeze({
    key: 'high',
    label: 'High (Gaming PC Ultra)',
    maxDpr: 2.0,
    antialias: true,
    shadows: true,
    shadowMapSize: 2048,
    sceneryCount: 320,
    grassCount: 320,
    cloudCount: 26,
    particleCount: 280,
    terrainSegX: 64,
    terrainSegZ: 48,
    farClip: 360,
    fogNear: 95,
    fogFar: 340,
    useStandardMaterials: true,
  }),
});

export function getQualityPreset(key) {
  return QUALITY_PRESETS[key] || QUALITY_PRESETS.medium;
}

export const WORLD_THEMES = Object.freeze({
  forest: Object.freeze({
    key: 'forest',
    label: 'Forest Trail',
    skyTop: '#2563eb',
    skyMid: '#60a5fa',
    skyHorizon: '#dbeafe',
    fogColor: '#cfe8f9',
    hemiSky: '#e0f2fe',
    hemiGround: '#3f6212',
    sunColor: '#fff7ed',
    sunIntensity: 2.2,
    sunDiscColor: '#fef08a',
    sunHaloColor: '#fde68a',
    cloudColor: '#ffffff',
    terrainPrimary: '#4ade80',
    terrainSecondary: '#16a34a',
    mountainColor: '#64748b',
    mountainCapColor: '#f8fafc',
    roadBase: '#475569',
    roadStripe: '#f8fafc',
    roadShoulder: '#cbd5e1',
    trunkColor: '#7c4a2d',
    canopyColor: '#15803d',
    canopyAltColor: '#22c55e',
    grassColor: '#84cc16',
    propColor: '#94a3b8',
    particleColor: '#fef08a',
    archColor: '#0ea5e9',
    ghostColor: '#38bdf8',
  }),
  coastal: Object.freeze({
    key: 'coastal',
    label: 'Coastal Sunset',
    skyTop: '#2563eb',
    skyMid: '#fb923c',
    skyHorizon: '#fef08a',
    fogColor: '#fed7aa',
    hemiSky: '#ffedd5',
    hemiGround: '#92400e',
    sunColor: '#ffedd5',
    sunIntensity: 2.3,
    sunDiscColor: '#fef08a',
    sunHaloColor: '#fb923c',
    cloudColor: '#ffe4c4',
    terrainPrimary: '#e2b97f',
    terrainSecondary: '#06b6d4',
    mountainColor: '#b47d56',
    mountainCapColor: '#fde68a',
    roadBase: '#6b5344',
    roadStripe: '#fef3c7',
    roadShoulder: '#f5d0a9',
    trunkColor: '#78553a',
    canopyColor: '#15803d',
    canopyAltColor: '#10b981',
    grassColor: '#a3e635',
    propColor: '#fbbf24',
    particleColor: '#fde68a',
    archColor: '#f97316',
    ghostColor: '#34d399',
  }),
  synthwave: Object.freeze({
    key: 'synthwave',
    label: 'Synthwave Grid',
    skyTop: '#1e1b4b',
    skyMid: '#7e22ce',
    skyHorizon: '#f43f5e',
    fogColor: '#4c1d95',
    hemiSky: '#e879f9',
    hemiGround: '#0891b2',
    sunColor: '#fda4af',
    sunIntensity: 1.9,
    sunDiscColor: '#fb7185',
    sunHaloColor: '#f472b6',
    cloudColor: '#c084fc',
    terrainPrimary: '#1e1038',
    terrainSecondary: '#22d3ee',
    mountainColor: '#31105e',
    mountainCapColor: '#f472b6',
    roadBase: '#1a1236',
    roadStripe: '#22d3ee',
    roadShoulder: '#f472b6',
    trunkColor: '#4338ca',
    canopyColor: '#22d3ee',
    canopyAltColor: '#f472b6',
    grassColor: '#c084fc',
    propColor: '#e879f9',
    particleColor: '#22d3ee',
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
