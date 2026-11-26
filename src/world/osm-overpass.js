/**
 * OpenStreetMap Overpass API corridor query builder and road surface classifier.
 * Cache Overpass responses locally in IndexedDB / localStorage by route hash to
 * stay within public Overpass rate limits.
 */

const METERS_PER_DEG_LAT = 111320;

/**
 * Compute a padded WGS84 bounding box around a GPX route corridor.
 * @param {Array<{ lat: number, lon: number }>} points
 * @param {number} [marginMeters=250]
 * @returns {{ south: number, west: number, north: number, east: number }}
 */
export function computeRouteCorridorBbox(points, marginMeters = 250) {
  if (!Array.isArray(points) || points.length === 0) {
    throw new Error('points must be a non-empty array');
  }

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }

  const midLat = (minLat + maxLat) * 0.5;
  const cosLat = Math.max(0.1, Math.cos((midLat * Math.PI) / 180));
  const dLat = marginMeters / METERS_PER_DEG_LAT;
  const dLon = marginMeters / (METERS_PER_DEG_LAT * cosLat);

  return {
    south: minLat - dLat,
    west: minLon - dLon,
    north: maxLat + dLat,
    east: maxLon + dLon,
  };
}

/**
 * Build an Overpass QL query fetching roads, forests, water, and buildings
 * within a route corridor bounding box.
 *
 * @param {{ south: number, west: number, north: number, east: number }} bbox
 * @param {{ timeoutSec?: number }} [opts]
 * @returns {string}
 */
export function buildOverpassCorridorQuery(bbox, { timeoutSec = 25 } = {}) {
  const b = `${bbox.south.toFixed(6)},${bbox.west.toFixed(6)},${bbox.north.toFixed(6)},${bbox.east.toFixed(6)}`;
  return [
    `[out:json][timeout:${Math.round(timeoutSec)}];`,
    '(',
    `  way["highway"](${b});`,
    `  way["natural"~"wood|water"](${b});`,
    `  relation["natural"~"wood|water"](${b});`,
    `  way["landuse"~"forest|meadow|farmland"](${b});`,
    `  way["waterway"](${b});`,
    `  way["building"](${b});`,
    ');',
    'out body;',
    '>;',
    'out skel qt;',
  ].join('\n');
}

function parseOsmWidthMeters(tags) {
  if (tags.width) {
    const numeric = Number.parseFloat(String(tags.width).replace(/m/i, '').trim());
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  }
  const lanes = Number(tags.lanes);
  if (Number.isFinite(lanes) && lanes > 0) {
    return lanes * 3.2;
  }
  switch (tags.highway) {
    case 'motorway':
    case 'trunk':
    case 'primary':
      return 7.5;
    case 'secondary':
    case 'tertiary':
      return 6.5;
    case 'cycleway':
    case 'path':
    case 'footway':
      return 2.8;
    case 'track':
      return 3.2;
    default:
      return 5.5;
  }
}

/**
 * Classify OSM way tags into cycling surface physics and rendering metadata.
 *
 * @param {Record<string, string>} [tags]
 * @returns {{
 *   surface: 'asphalt' | 'gravel' | 'cobbles' | 'dirt',
 *   crr: number,
 *   widthM: number,
 *   isBridge: boolean,
 *   isTunnel: boolean,
 * }}
 */
export function classifyRoadSurface(tags = {}) {
  const rawSurface = String(tags.surface ?? '').toLowerCase();
  const highway = String(tags.highway ?? '').toLowerCase();

  let surface = 'asphalt';
  let crr = 0.004;

  if (
    rawSurface.includes('cobble') ||
    rawSurface.includes('sett') ||
    rawSurface === 'paving_stones'
  ) {
    surface = 'cobbles';
    crr = 0.0095;
  } else if (
    rawSurface === 'gravel' ||
    rawSurface === 'fine_gravel' ||
    rawSurface === 'compacted' ||
    rawSurface === 'pebblestone' ||
    highway === 'track'
  ) {
    surface = 'gravel';
    crr = 0.0075;
  } else if (
    rawSurface === 'dirt' ||
    rawSurface === 'earth' ||
    rawSurface === 'mud' ||
    rawSurface === 'sand' ||
    rawSurface === 'grass' ||
    rawSurface === 'ground'
  ) {
    surface = 'dirt';
    crr = 0.011;
  }

  const isBridge = Boolean(tags.bridge && tags.bridge !== 'no');
  const isTunnel = Boolean(tags.tunnel && tags.tunnel !== 'no');

  return {
    surface,
    crr,
    widthM: parseOsmWidthMeters(tags),
    isBridge,
    isTunnel,
  };
}
