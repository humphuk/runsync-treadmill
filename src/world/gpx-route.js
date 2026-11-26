/**
 * Phase 2B GPX Course Engine:
 * - Parses any .gpx XML into smoothed, arc-length-resampled 3D route samples
 * - Provides O(log N) distance sampling & looping along the 3D path
 * - Computes upcoming treadmill incline change callouts (lookahead)
 * - Includes 3 built-in offline GPX courses for instant testing on Duet or PC
 */

import {
  parseGpxPoints,
  projectLatLonToEnu,
  resampleByArcLength,
  smoothElevation,
} from './gpx-processor.js';

const EARTH_RADIUS_M = 6378137;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Inverse of projectLatLonToEnu for XZ coordinates.
 * @param {number} x East meters
 * @param {number} z South meters (-North)
 * @param {{ lat: number, lon: number }} origin
 * @returns {{ lat: number, lon: number }}
 */
export function enuToLatLon(x, z, origin) {
  const cosLat0 = Math.max(0.1, Math.cos(origin.lat * DEG_TO_RAD));
  const lat = origin.lat + (-z / EARTH_RADIUS_M) * RAD_TO_DEG;
  const lon = origin.lon + (x / (EARTH_RADIUS_M * cosLat0)) * RAD_TO_DEG;
  return { lat, lon };
}

/**
 * Project WGS84 lat/lon to local ENU (x, z) matching Three.js Y-up coordinates.
 * @param {number} lat
 * @param {number} lon
 * @param {{ lat: number, lon: number }} origin
 * @returns {{ x: number, z: number }}
 */
export function latLonToEnuXZ(lat, lon, origin) {
  const cosLat0 = Math.max(0.1, Math.cos(origin.lat * DEG_TO_RAD));
  const x = (lon - origin.lon) * DEG_TO_RAD * EARTH_RADIUS_M * cosLat0;
  const z = -(lat - origin.lat) * DEG_TO_RAD * EARTH_RADIUS_M;
  return { x, z };
}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function normalize3(v, fallback = [0, 0, -1]) {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-8) {
    return [...fallback];
  }
  return [v[0] / len, v[1] / len, v[2] / len];
}

function makeLoopGpxXml(name, originLat, originLon, pointCount, rxMeters, rzMeters, eleFn) {
  const mPerDegLat = 111319.5;
  const mPerDegLon = 111319.5 * Math.cos((originLat * Math.PI) / 180);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="RunSync">',
    `  <trk><name>${name}</name><trkseg>`,
  ];

  for (let i = 0; i <= pointCount; i += 1) {
    const p = i / pointCount;
    const theta = p * Math.PI * 2;
    // Gentle winding oval with slight S-bend for natural turns
    const eastM = Math.sin(theta) * rxMeters + Math.sin(theta * 2) * (rxMeters * 0.14);
    const northM = (1 - Math.cos(theta)) * rzMeters;
    const lat = originLat + northM / mPerDegLat;
    const lon = originLon + eastM / mPerDegLon;
    const ele = eleFn(p);
    lines.push(`    <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><ele>${ele.toFixed(1)}</ele></trkpt>`);
  }

  lines.push('  </trkseg></trk>', '</gpx>');
  return lines.join('\n');
}

export const BUILTIN_GPX_COURSES = Object.freeze([
  Object.freeze({
    id: 'box-hill-5k',
    name: 'Box Hill 5K Loop (Surrey Hills)',
    xml: makeLoopGpxXml('Box Hill 5K Loop', 51.255, -0.321, 120, 740, 820, (p) => {
      // Flat start -> sustained 5-6% climb -> summit ridge -> fast descent
      if (p < 0.14) return 56;
      if (p < 0.44) {
        const u = (p - 0.14) / 0.3;
        return 56 + 78 * (0.5 - 0.5 * Math.cos(u * Math.PI));
      }
      if (p < 0.58) return 134 + Math.sin(((p - 0.44) / 0.14) * Math.PI) * 5;
      if (p < 0.88) {
        const u = (p - 0.58) / 0.3;
        return 134 - 78 * (0.5 - 0.5 * Math.cos(u * Math.PI));
      }
      return 56;
    }),
  }),
  Object.freeze({
    id: 'rolling-parkrun-5k',
    name: 'Rolling Parkrun 5K',
    xml: makeLoopGpxXml('Rolling Parkrun 5K', 51.45, -0.18, 120, 760, 800, (p) => {
      return 42 + 16 * Math.sin(p * Math.PI * 2) + 8 * Math.sin(p * Math.PI * 6);
    }),
  }),
  Object.freeze({
    id: 'alpine-repeats-4k',
    name: 'Alpine Hill Repeats (4K)',
    xml: makeLoopGpxXml('Alpine Hill Repeats 4K', 46.54, 7.98, 110, 610, 640, (p) => {
      // Three distinct climbing steps separated by level recovery platforms
      const pulse = (start, end, gain) => {
        if (p <= start) return 0;
        if (p >= end) return gain;
        const u = (p - start) / (end - start);
        return gain * (0.5 - 0.5 * Math.cos(u * Math.PI));
      };
      if (p < 0.72) {
        return 800 + pulse(0.08, 0.22, 34) + pulse(0.28, 0.44, 42) + pulse(0.5, 0.66, 48);
      }
      const down = (p - 0.72) / 0.28;
      return 924 - 124 * (0.5 - 0.5 * Math.cos(down * Math.PI));
    }),
  }),
]);

/**
 * Parse GPX XML and build a smoothed, arc-length-resampled 3D route.
 * @param {string} gpxXml
 * @param {string} [name='Custom GPX']
 * @param {string} [id='custom']
 */
export function buildRouteFromGpx(gpxXml, name = 'Custom GPX', id = 'custom') {
  const rawPts = parseGpxPoints(gpxXml);
  if (rawPts.length < 2) {
    throw new Error('GPX file must contain at least 2 track/route points.');
  }

  const enu = projectLatLonToEnu(rawPts);
  const smoothed = smoothElevation(enu, 9, { maxGrade: 0.22 });
  const resampled = resampleByArcLength(smoothed, 5);
  if (resampled.length < 2) {
    throw new Error('GPX track distance is too short.');
  }

  const baseEle = rawPts[0].ele ?? 0;
  let minEleM = Infinity;
  let maxEleM = -Infinity;
  let totalAscentM = 0;

  const samples = resampled.map((s, idx) => {
    const eleM = baseEle + s.y;
    minEleM = Math.min(minEleM, eleM);
    maxEleM = Math.max(maxEleM, eleM);
    if (idx > 0) {
      const dy = s.y - resampled[idx - 1].y;
      if (dy > 0) {
        totalAscentM += dy;
      }
    }
    const gradePct = Math.round(clamp(s.grade * 100, -15, 20) * 10) / 10;
    return {
      ...s,
      eleM,
      gradePct,
    };
  });

  const totalDistanceM = samples[samples.length - 1].s;
  return {
    id,
    name,
    origin: {
      lat: rawPts[0].lat,
      lon: rawPts[0].lon,
      ele: baseEle,
    },
    samples,
    totalDistanceM,
    totalAscentM: Math.round(totalAscentM * 10) / 10,
    minEleM,
    maxEleM,
  };
}

export function getBuiltinRoute(id) {
  const entry = BUILTIN_GPX_COURSES.find((c) => c.id === id);
  if (!entry) {
    return null;
  }
  return buildRouteFromGpx(entry.xml, entry.name, entry.id);
}

/**
 * Sample route position, elevation, grade, and stabilized tangent/right frame at distanceM.
 * @param {ReturnType<typeof buildRouteFromGpx>} route
 * @param {number} distanceM
 * @param {{ loop?: boolean }} [opts]
 */
export function sampleRouteAtDistance(route, distanceM, { loop = true } = {}) {
  const samples = route.samples;
  const total = Math.max(0.01, route.totalDistanceM);
  let targetS = Number.isFinite(distanceM) ? distanceM : 0;
  if (loop) {
    targetS = ((targetS % total) + total) % total;
  } else {
    targetS = clamp(targetS, 0, total);
  }

  let lo = 0;
  let hi = samples.length - 2;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].s <= targetS) {
      if (samples[mid + 1].s >= targetS) {
        lo = mid;
        break;
      }
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const idx = clamp(lo, 0, samples.length - 2);
  const a = samples[idx];
  const b = samples[idx + 1];
  const span = Math.max(1e-6, b.s - a.s);
  const t = clamp((targetS - a.s) / span, 0, 1);

  const tangent = normalize3([
    a.tangent[0] + (b.tangent[0] - a.tangent[0]) * t,
    a.tangent[1] + (b.tangent[1] - a.tangent[1]) * t,
    a.tangent[2] + (b.tangent[2] - a.tangent[2]) * t,
  ]);
  const right = normalize3(
    [
      a.right[0] + (b.right[0] - a.right[0]) * t,
      a.right[1] + (b.right[1] - a.right[1]) * t,
      a.right[2] + (b.right[2] - a.right[2]) * t,
    ],
    [1, 0, 0],
  );

  return {
    s: targetS,
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    eleM: a.eleM + (b.eleM - a.eleM) * t,
    gradePct: a.gradePct + (b.gradePct - a.gradePct) * t,
    tangent,
    right,
    progress01: targetS / total,
  };
}

/**
 * Look ahead on the GPX route and generate an actionable incline cue for the
 * dumb Roger Black treadmill whenever upcoming grade changes significantly.
 */
export function computeUpcomingGradeAlert(
  route,
  distanceM,
  {
    lookaheadM = 60,
    windowM = 40,
    lastAnnouncedPct = 0,
    minDeltaPct = 1.0,
    loop = true,
  } = {},
) {
  let gradeSum = 0;
  const taps = 5;
  for (let i = 0; i < taps; i += 1) {
    const sampleDist = distanceM + lookaheadM + (i / (taps - 1)) * windowM;
    const smp = sampleRouteAtDistance(route, sampleDist, { loop });
    gradeSum += smp.gradePct;
  }
  const avgGrade = gradeSum / taps;
  const clamped = clamp(avgGrade, 0, 15);
  const targetInclinePct = Math.round(clamped * 2) / 2;
  const deltaPct = targetInclinePct - lastAnnouncedPct;

  if (Math.abs(deltaPct) < minDeltaPct) {
    return {
      shouldPrompt: false,
      targetInclinePct,
      deltaPct,
      promptText: '',
    };
  }

  let promptText;
  if (targetInclinePct <= 0.5) {
    promptText = `Flattening out in ${lookaheadM} metres. Drop incline to ${targetInclinePct} percent.`;
  } else if (deltaPct > 0) {
    promptText = `In ${lookaheadM} metres, ${targetInclinePct} percent climb. Bump incline to ${targetInclinePct}.`;
  } else {
    promptText = `Easing in ${lookaheadM} metres. Lower incline to ${targetInclinePct} percent.`;
  }

  return {
    shouldPrompt: true,
    targetInclinePct,
    deltaPct,
    promptText,
  };
}
