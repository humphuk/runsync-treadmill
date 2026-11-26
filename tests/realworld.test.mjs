import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decodeTerrariumRgb,
  latLonToTileXY,
  sampleHeightfieldBilinear,
  tileXYToBounds,
} from '../src/world/terrarium-dem.js';
import { computeRouteCorridorBbox } from '../src/world/osm-overpass.js';
import { enuToLatLon, getBuiltinRoute, latLonToEnuXZ } from '../src/world/gpx-route.js';
import {
  computeDemDatumOffset,
  computeTileGridForBbox,
  extractOsmBuildings,
} from '../src/world/real-world-loader.js';

test('decodeTerrariumRgb, latLonToTileXY, tileXYToBounds, and bilinear sampler work accurately', () => {
  // Sea level (0 m) in Terrarium is R=128, G=0, B=0
  assert.equal(decodeTerrariumRgb(128, 0, 0), 0);
  // 256.5 m -> R=129, G=0, B=128
  assert.equal(decodeTerrariumRgb(129, 0, 128), 256.5);

  const tile = latLonToTileXY(51.255, -0.321, 13);
  const bounds = tileXYToBounds(tile.tx, tile.ty, 13);
  assert.ok(bounds.north >= 51.255 && bounds.south <= 51.255);
  assert.ok(bounds.east >= -0.321 && bounds.west <= -0.321);

  const grid = { width: 2, height: 2, data: new Float32Array([0, 10, 20, 30]) };
  assert.equal(sampleHeightfieldBilinear(grid, 0.5, 0.5), 15);
});

test('enuToLatLon and latLonToEnuXZ round-trip within < 0.05 m', () => {
  const origin = { lat: 51.255, lon: -0.321, ele: 56 };
  const geo = enuToLatLon(425.5, -612.25, origin);
  const back = latLonToEnuXZ(geo.lat, geo.lon, origin);
  assert.ok(Math.abs(back.x - 425.5) < 0.05);
  assert.ok(Math.abs(back.z - -612.25) < 0.05);
});

test('computeTileGridForBbox limits tile count by stepping down zoom for wide corridors', () => {
  const route = getBuiltinRoute('box-hill-5k');
  const bbox = computeRouteCorridorBbox(route.samples, 220);
  const grid = computeTileGridForBbox(bbox, 13, 16);
  assert.ok(grid.tileCount <= 16);
  assert.ok(grid.zoom <= 13 && grid.zoom >= 10);
  assert.ok(grid.bounds.north >= bbox.north && grid.bounds.south <= bbox.south);
});

test('computeDemDatumOffset aligns DEM elevation median to GPX track y', () => {
  const route = getBuiltinRoute('rolling-parkrun-5k');
  const fakeOffset = 42.5;
  const computed = computeDemDatumOffset(route, (x, z) => {
    const match = route.samples.find((s) => Math.hypot(s.x - x, s.z - z) < 1);
    return (match ? match.y : 0) - fakeOffset;
  });
  assert.ok(Math.abs(computed - fakeOffset) < 0.1);
});

test('extractOsmBuildings extracts building geometry and rejects footprints overlapping road', () => {
  const route = getBuiltinRoute('box-hill-5k');
  const s0 = route.samples[10];
  const offRoad = enuToLatLon(s0.x + s0.right[0] * 25, s0.z + s0.right[2] * 25, route.origin);
  const onRoad = enuToLatLon(s0.x, s0.z, route.origin);

  const mockOverpass = {
    elements: [
      // Building 25m off road (should be kept, height from 3 levels = 9.6m)
      { type: 'node', id: 1, lat: offRoad.lat, lon: offRoad.lon },
      { type: 'node', id: 2, lat: offRoad.lat + 0.0001, lon: offRoad.lon },
      { type: 'node', id: 3, lat: offRoad.lat + 0.0001, lon: offRoad.lon + 0.00015 },
      { type: 'node', id: 4, lat: offRoad.lat, lon: offRoad.lon + 0.00015 },
      { type: 'way', id: 100, nodes: [1, 2, 3, 4, 1], tags: { building: 'yes', 'building:levels': '3' } },

      // Building directly on top of road centerline (should be filtered out)
      { type: 'node', id: 5, lat: onRoad.lat, lon: onRoad.lon },
      { type: 'node', id: 6, lat: onRoad.lat + 0.00005, lon: onRoad.lon },
      { type: 'node', id: 7, lat: onRoad.lat + 0.00005, lon: onRoad.lon + 0.00005 },
      { type: 'way', id: 101, nodes: [5, 6, 7, 5], tags: { building: 'house' } },
    ],
  };

  const buildings = extractOsmBuildings(mockOverpass, route, { minRoadClearanceM: 7.0 });
  assert.equal(buildings.length, 1);
  assert.ok(Math.abs(buildings[0].heightM - 9.6) < 1e-4);
  assert.ok(buildings[0].widthM >= 4.5 && buildings[0].depthM >= 4.5);
});
