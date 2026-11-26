/**
 * Zero-dependency GPX parser, ENU projection, elevation smoother, and
 * up-vector-stabilized arc-length resampler for 3D cycling/running worlds.
 */

const DEG_TO_RAD = Math.PI / 180;
const EARTH_RADIUS_M = 6378137;

function parseAttrs(attrStr) {
  const attrs = {};
  const re = /([A-Za-z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = re.exec(attrStr)) !== null) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? '';
  }
  return attrs;
}

/**
 * Parse `<trkpt>` or `<rtept>` coordinates and elevations from a GPX XML string.
 * Compatible with both browsers and Node.js (no DOMParser required).
 *
 * @param {string} gpxXml
 * @returns {Array<{ lat: number, lon: number, ele: number, time: string | null }>}
 */
export function parseGpxPoints(gpxXml) {
  if (typeof gpxXml !== 'string') {
    throw new TypeError('gpxXml must be a string');
  }

  const points = [];
  const ptRe = /<(trkpt|rtept)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
  let match;

  while ((match = ptRe.exec(gpxXml)) !== null) {
    const attrs = parseAttrs(match[2] ?? '');
    const lat = Number(attrs.lat);
    const lon = Number(attrs.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue;
    }

    const inner = match[3] ?? '';
    const eleMatch = /<ele\b[^>]*>([\s\S]*?)<\/ele>/i.exec(inner);
    const timeMatch = /<time\b[^>]*>([\s\S]*?)<\/time>/i.exec(inner);
    const eleParsed = eleMatch ? Number(eleMatch[1].trim()) : 0;

    points.push({
      lat,
      lon,
      ele: Number.isFinite(eleParsed) ? eleParsed : 0,
      time: timeMatch ? timeMatch[1].trim() : null,
    });
  }

  return points;
}

/**
 * Project WGS84 lat/lon/ele points to local East-North-Up meters mapped to Three.js
 * right-handed Y-up coordinates (`+X` = East, `+Y` = Up, `-Z` = North).
 *
 * @param {Array<{ lat: number, lon: number, ele?: number }>} points
 * @param {{ lat: number, lon: number, ele?: number }} [origin]
 * @returns {Array<{ lat: number, lon: number, ele: number, x: number, y: number, z: number }>}
 */
export function projectLatLonToEnu(points, origin = points[0]) {
  if (!Array.isArray(points) || points.length === 0) {
    return [];
  }

  const refLat = origin.lat;
  const refLon = origin.lon;
  const refEle = origin.ele ?? 0;
  const cosLat0 = Math.cos(refLat * DEG_TO_RAD);

  return points.map((p) => {
    const ele = p.ele ?? 0;
    const dLat = (p.lat - refLat) * DEG_TO_RAD;
    const dLon = (p.lon - refLon) * DEG_TO_RAD;
    const east = dLon * EARTH_RADIUS_M * cosLat0;
    const north = dLat * EARTH_RADIUS_M;
    return {
      ...p,
      ele,
      x: east + 0,
      y: ele - refEle + 0,
      z: -north + 0,
    };
  });
}

/**
 * Smooth GPS altitude spikes using a centered triangular weighted window
 * and compute realistic clamped slope grades along the route.
 *
 * @template {{ x: number, y: number, z: number, ele?: number }} T
 * @param {T[]} points
 * @param {number} [windowSize=9] Odd window length (>= 3)
 * @param {{ maxGrade?: number }} [opts]
 * @returns {Array<T & { y: number, ele: number, grade: number }>}
 */
export function smoothElevation(points, windowSize = 9, { maxGrade = 0.28 } = {}) {
  if (!Array.isArray(points) || points.length === 0) {
    return [];
  }

  const half = Math.max(1, Math.floor(windowSize / 2));
  const smoothed = points.map((p, idx) => {
    let weightedY = 0;
    let weightedEle = 0;
    let totalWeight = 0;

    for (let offset = -half; offset <= half; offset += 1) {
      const j = idx + offset;
      if (j < 0 || j >= points.length) {
        continue;
      }
      const weight = half + 1 - Math.abs(offset);
      weightedY += points[j].y * weight;
      weightedEle += (points[j].ele ?? points[j].y) * weight;
      totalWeight += weight;
    }

    return {
      ...p,
      y: weightedY / totalWeight,
      ele: weightedEle / totalWeight,
      grade: 0,
    };
  });

  for (let i = 0; i < smoothed.length; i += 1) {
    const prev = smoothed[Math.max(0, i - 1)];
    const next = smoothed[Math.min(smoothed.length - 1, i + 1)];
    const horizDist = Math.hypot(next.x - prev.x, next.z - prev.z);
    if (horizDist > 0.1) {
      const rawGrade = (next.y - prev.y) / horizDist;
      smoothed[i].grade = Math.min(maxGrade, Math.max(-maxGrade, rawGrade));
    }
  }

  return smoothed;
}

function normalize3(x, y, z, fallback = [0, 0, -1]) {
  const len = Math.hypot(x, y, z);
  if (len < 1e-8) {
    return [...fallback];
  }
  return [x / len, y / len, z / len];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * Resample projected route points by uniform arc length and attach
 * up-vector-stabilized frames (`tangent`, `right`) to prevent Frenet twist.
 *
 * @param {Array<{ x: number, y: number, z: number, lat?: number, lon?: number, ele?: number, grade?: number }>} points
 * @param {number} [stepMeters=5]
 * @returns {Array<{
 *   s: number,
 *   x: number,
 *   y: number,
 *   z: number,
 *   lat: number,
 *   lon: number,
 *   grade: number,
 *   tangent: [number, number, number],
 *   right: [number, number, number],
 * }>}
 */
export function resampleByArcLength(points, stepMeters = 5) {
  if (!Array.isArray(points) || points.length === 0) {
    return [];
  }
  if (points.length === 1) {
    return [
      {
        s: 0,
        x: points[0].x,
        y: points[0].y,
        z: points[0].z,
        lat: points[0].lat ?? 0,
        lon: points[0].lon ?? 0,
        grade: points[0].grade ?? 0,
        tangent: [0, 0, -1],
        right: [1, 0, 0],
      },
    ];
  }

  const safeStep = Math.max(0.25, stepMeters);
  const cumDist = [0];
  for (let i = 1; i < points.length; i += 1) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const dz = points[i].z - points[i - 1].z;
    cumDist.push(cumDist[i - 1] + Math.hypot(dx, dy, dz));
  }

  const totalLength = cumDist[cumDist.length - 1];
  const samples = [];
  let segIdx = 0;

  const sampleAtDistance = (targetS) => {
    while (segIdx < cumDist.length - 2 && cumDist[segIdx + 1] < targetS) {
      segIdx += 1;
    }
    const s0 = cumDist[segIdx];
    const s1 = cumDist[segIdx + 1];
    const span = Math.max(1e-8, s1 - s0);
    const t = Math.min(1, Math.max(0, (targetS - s0) / span));
    const a = points[segIdx];
    const b = points[segIdx + 1];

    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const z = a.z + (b.z - a.z) * t;
    const lat = (a.lat ?? 0) + ((b.lat ?? 0) - (a.lat ?? 0)) * t;
    const lon = (a.lon ?? 0) + ((b.lon ?? 0) - (a.lon ?? 0)) * t;
    const horiz = Math.hypot(b.x - a.x, b.z - a.z);
    const grade = horiz > 0.05 ? (b.y - a.y) / horiz : (a.grade ?? 0);

    return { s: targetS, x, y, z, lat, lon, grade };
  };

  for (let s = 0; s < totalLength; s += safeStep) {
    samples.push(sampleAtDistance(s));
  }
  const lastSample = samples[samples.length - 1];
  if (!lastSample || totalLength - lastSample.s > safeStep * 0.25) {
    samples.push(sampleAtDistance(totalLength));
  }

  for (let i = 0; i < samples.length; i += 1) {
    const prev = samples[Math.max(0, i - 1)];
    const next = samples[Math.min(samples.length - 1, i + 1)];
    const tangent = normalize3(next.x - prev.x, next.y - prev.y, next.z - prev.z);
    const rawRight = cross3(tangent, [0, 1, 0]);
    const right = normalize3(rawRight[0], rawRight[1], rawRight[2], [1, 0, 0]);
    samples[i].tangent = tangent;
    samples[i].right = right;
  }

  return samples;
}
