/**
 * Phase 2C Real-World Terrain & Scenery Loader:
 * - Fetches AWS Terrarium DEM elevation PNG tiles around any GPX corridor
 * - Fetches OpenStreetMap building footprints via Overpass API with localStorage caching
 * - Aligns DEM datum to the GPX track and filters buildings away from the road
 */

import { enuToLatLon, latLonToEnuXZ } from './gpx-route.js';
import { computeRouteCorridorBbox } from './osm-overpass.js';
import {
  decodeTerrariumRgb,
  getTerrariumTileUrl,
  latLonToTileXY,
  sampleHeightfieldBilinear,
  tileXYToBounds,
} from './terrarium-dem.js';

const OSM_CACHE_PREFIX = 'runsync_osm_v2_';

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

/**
 * Compute Web Mercator tile grid covering bbox, stepping down zoom if needed
 * so tile fetch count stays within maxTiles.
 */
export function computeTileGridForBbox(bbox, zoom = 13, maxTiles = 16) {
  let z = zoom;
  let minTx;
  let maxTx;
  let minTy;
  let maxTy;
  let cols;
  let rows;

  while (z >= 10) {
    const nw = latLonToTileXY(bbox.north, bbox.west, z);
    const se = latLonToTileXY(bbox.south, bbox.east, z);
    minTx = Math.min(nw.tx, se.tx);
    maxTx = Math.max(nw.tx, se.tx);
    minTy = Math.min(nw.ty, se.ty);
    maxTy = Math.max(nw.ty, se.ty);
    cols = maxTx - minTx + 1;
    rows = maxTy - minTy + 1;
    if (cols * rows <= maxTiles || z === 10) {
      break;
    }
    z -= 1;
  }

  const nwBounds = tileXYToBounds(minTx, minTy, z);
  const seBounds = tileXYToBounds(maxTx, maxTy, z);

  return {
    zoom: z,
    minTx,
    maxTx,
    minTy,
    maxTy,
    cols,
    rows,
    tileCount: cols * rows,
    bounds: {
      north: nwBounds.north,
      west: nwBounds.west,
      south: seBounds.south,
      east: seBounds.east,
    },
  };
}

/**
 * Compute median vertical datum offset (route.y - demElevation) across 12 route taps
 * so DEM terrain meets the GPX road ribbon smoothly without vertical step seams.
 */
export function computeDemDatumOffset(route, sampleDemFn) {
  const samples = route?.samples;
  if (!Array.isArray(samples) || samples.length === 0) {
    return 0;
  }
  const diffs = [];
  const taps = Math.min(12, samples.length);
  for (let i = 0; i < taps; i += 1) {
    const idx = Math.floor((i / Math.max(1, taps - 1)) * (samples.length - 1));
    const s = samples[idx];
    const demVal = sampleDemFn(s.x, s.z);
    if (Number.isFinite(demVal)) {
      diffs.push(s.y - demVal);
    }
  }
  if (diffs.length === 0) {
    return 0;
  }
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

/**
 * Extract compact 3D building descriptors from Overpass JSON, filtering out
 * any structure overlapping the running path.
 */
export function extractOsmBuildings(
  overpassJson,
  route,
  { maxBuildings = 260, minRoadClearanceM = 7.0 } = {},
) {
  const elements = overpassJson?.elements;
  if (!Array.isArray(elements) || !route?.origin || !Array.isArray(route?.samples)) {
    return [];
  }

  const nodes = new Map();
  for (const el of elements) {
    if (el.type === 'node' && Number.isFinite(el.lat) && Number.isFinite(el.lon)) {
      nodes.set(el.id, el);
    }
  }

  // Decimate route samples for fast minimum-distance clearance checks
  const roadStride = Math.max(1, Math.floor(route.samples.length / 240));
  const roadPts = [];
  for (let i = 0; i < route.samples.length; i += roadStride) {
    roadPts.push(route.samples[i]);
  }
  const minClearSq = minRoadClearanceM * minRoadClearanceM;

  const candidates = [];

  for (const el of elements) {
    if (el.type !== 'way' || !el.tags?.building || !Array.isArray(el.nodes) || el.nodes.length < 3) {
      continue;
    }

    const pts = [];
    for (const nid of el.nodes) {
      const node = nodes.get(nid);
      if (node) {
        pts.push(latLonToEnuXZ(node.lat, node.lon, route.origin));
      }
    }
    if (pts.length < 3) {
      continue;
    }

    let sumX = 0;
    let sumZ = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of pts) {
      sumX += p.x;
      sumZ += p.z;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const cx = sumX / pts.length;
    const cz = sumZ / pts.length;

    let nearestDistSq = Infinity;
    let nearestY = 0;
    let nearestX = cx;
    let nearestZ = cz;
    for (let i = 0; i < roadPts.length - 1; i += 1) {
      const a = roadPts[i];
      const b = roadPts[i + 1];
      const segDx = b.x - a.x;
      const segDz = b.z - a.z;
      const segLenSq = segDx * segDx + segDz * segDz;
      const t =
        segLenSq > 1e-6
          ? Math.max(0, Math.min(1, ((cx - a.x) * segDx + (cz - a.z) * segDz) / segLenSq))
          : 0;
      const px = a.x + segDx * t;
      const pz = a.z + segDz * t;
      const dSq = (cx - px) * (cx - px) + (cz - pz) * (cz - pz);
      if (dSq < nearestDistSq) {
        nearestDistSq = dSq;
        nearestY = a.y + (b.y - a.y) * t;
        nearestX = px;
        nearestZ = pz;
      }
    }

    if (nearestDistSq < minClearSq || nearestDistSq > 180 * 180) {
      continue;
    }

    const dxEdge = pts[1].x - pts[0].x;
    const dzEdge = pts[1].z - pts[0].z;
    const yawRad = Math.atan2(dxEdge, dzEdge);

    const widthM = clamp(maxX - minX, 4.5, 26);
    const depthM = clamp(maxZ - minZ, 4.5, 26);

    let heightM = 6.5;
    if (el.tags.height) {
      const parsedH = Number.parseFloat(String(el.tags.height));
      if (Number.isFinite(parsedH) && parsedH > 2) {
        heightM = clamp(parsedH, 3.5, 42);
      }
    } else if (el.tags['building:levels']) {
      const levels = Number.parseFloat(String(el.tags['building:levels']));
      if (Number.isFinite(levels) && levels > 0) {
        heightM = clamp(levels * 3.2, 3.5, 42);
      }
    } else {
      heightM = 5.5 + ((Math.abs(Math.round(cx + cz)) % 5) * 0.9);
    }

    candidates.push({
      cx,
      cz,
      roadX: nearestX,
      roadZ: nearestZ,
      yBaseHint: nearestY,
      widthM,
      depthM,
      heightM,
      yawRad,
      distSq: nearestDistSq,
    });
  }

  candidates.sort((a, b) => a.distSq - b.distSq);
  return candidates.slice(0, maxBuildings).map(({ distSq: _unused, ...rest }) => rest);
}

function loadCorsImage(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => {
      reject(new Error(`DEM tile timeout: ${url}`));
    }, timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`DEM tile error: ${url}`));
    };
    img.src = url;
  });
}

/**
 * Fetch and stitch AWS Terrarium DEM tiles into a fast bilinear ENU heightfield.
 * Returns null if offline or tiles cannot be loaded.
 */
export async function fetchTerrariumHeightfield(route, { marginMeters = 220 } = {}) {
  if (!route?.origin || !Array.isArray(route?.samples) || route.samples.length === 0) {
    return null;
  }

  const bbox = computeRouteCorridorBbox(route.samples, marginMeters);
  const gridInfo = computeTileGridForBbox(bbox, 13, 16);
  const tileSubSize = 64; // 256 / 4 -> fast & lightweight for Duet
  const totalW = gridInfo.cols * tileSubSize;
  const totalH = gridInfo.rows * tileSubSize;
  const data = new Float32Array(totalW * totalH);

  const canvas = document.createElement('canvas');
  canvas.width = tileSubSize;
  canvas.height = tileSubSize;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const jobs = [];
  for (let ty = gridInfo.minTy; ty <= gridInfo.maxTy; ty += 1) {
    for (let tx = gridInfo.minTx; tx <= gridInfo.maxTx; tx += 1) {
      jobs.push({ tx, ty, url: getTerrariumTileUrl(tx, ty, gridInfo.zoom) });
    }
  }

  const images = await Promise.all(jobs.map((j) => loadCorsImage(j.url)));
  for (let i = 0; i < jobs.length; i += 1) {
    const { tx, ty } = jobs[i];
    const img = images[i];
    ctx.clearRect(0, 0, tileSubSize, tileSubSize);
    ctx.drawImage(img, 0, 0, tileSubSize, tileSubSize);
    const pixels = ctx.getImageData(0, 0, tileSubSize, tileSubSize).data;

    const baseCol = (tx - gridInfo.minTx) * tileSubSize;
    const baseRow = (ty - gridInfo.minTy) * tileSubSize;

    for (let py = 0; py < tileSubSize; py += 1) {
      for (let px = 0; px < tileSubSize; px += 1) {
        const pIdx = (py * tileSubSize + px) * 4;
        const ele = decodeTerrariumRgb(pixels[pIdx], pixels[pIdx + 1], pixels[pIdx + 2]);
        data[(baseRow + py) * totalW + (baseCol + px)] = ele;
      }
    }
  }

  const heightfield = { width: totalW, height: totalH, data };
  const sampleRawAtEnu = (x, z) => {
    const { lat, lon } = enuToLatLon(x, z, route.origin);
    const t = latLonToTileXY(lat, lon, gridInfo.zoom);
    const u = (t.tx + t.fx - gridInfo.minTx) / gridInfo.cols;
    const v = (t.ty + t.fy - gridInfo.minTy) / gridInfo.rows;
    return sampleHeightfieldBilinear(heightfield, u, v);
  };

  const datumOffset = computeDemDatumOffset(route, sampleRawAtEnu);

  return {
    zoom: gridInfo.zoom,
    tileCount: gridInfo.tileCount,
    sampleAtEnu: (x, z) => sampleRawAtEnu(x, z) + datumOffset,
  };
}

/**
 * Fetch OpenStreetMap buildings along the GPX route corridor via Overpass API,
 * caching compact parsed buildings in localStorage.
 */
export async function fetchOsmScenery(route, { marginMeters = 180, timeoutSec = 15 } = {}) {
  if (!route?.origin || !Array.isArray(route?.samples) || route.samples.length === 0) {
    return { buildings: [], fromCache: false };
  }

  const bbox = computeRouteCorridorBbox(route.samples, marginMeters);
  const cacheKey = `${OSM_CACHE_PREFIX}${bbox.south.toFixed(3)}_${bbox.west.toFixed(3)}_${bbox.north.toFixed(3)}_${bbox.east.toFixed(3)}`;

  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) {
        return { buildings: parsed, fromCache: true };
      }
    }
  } catch {
    // Ignore storage read errors.
  }

  const b = `${bbox.south.toFixed(6)},${bbox.west.toFixed(6)},${bbox.north.toFixed(6)},${bbox.east.toFixed(6)}`;
  const query = [
    `[out:json][timeout:${Math.round(timeoutSec)}];`,
    '(',
    `  way["building"](${b});`,
    ');',
    'out body;',
    '>;',
    'out skel qt;',
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSec * 1000);

  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Overpass HTTP ${res.status}`);
    }
    const json = await res.json();
    const buildings = extractOsmBuildings(json, route);

    try {
      localStorage.setItem(cacheKey, JSON.stringify(buildings));
    } catch {
      // Ignore storage quota errors.
    }

    return { buildings, fromCache: false };
  } finally {
    clearTimeout(timer);
  }
}
