import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRoadRibbonGeometry } from '../src/world/road-terrain-mesh.js';
import {
  BUILTIN_GPX_COURSES,
  buildRouteFromGpx,
  computeUpcomingGradeAlert,
  getBuiltinRoute,
  sampleRouteAtDistance,
} from '../src/world/gpx-route.js';

test('BUILTIN_GPX_COURSES parse cleanly with positive distance and elevation gain', () => {
  assert.equal(BUILTIN_GPX_COURSES.length, 3);
  for (const entry of BUILTIN_GPX_COURSES) {
    const route = getBuiltinRoute(entry.id);
    assert.ok(route, `Failed to build route ${entry.id}`);
    assert.ok(route.totalDistanceM > 3500, `${entry.id} too short: ${route.totalDistanceM}`);
    assert.ok(route.totalAscentM > 20, `${entry.id} ascent too low: ${route.totalAscentM}`);
    assert.ok(route.samples.length >= 100);
  }
});

test('sampleRouteAtDistance interpolates positions and loops seamlessly past totalDistanceM', () => {
  const route = getBuiltinRoute('box-hill-5k');
  const start = sampleRouteAtDistance(route, 0, { loop: true });
  const wrapped = sampleRouteAtDistance(route, route.totalDistanceM, { loop: true });
  const mid = sampleRouteAtDistance(route, route.totalDistanceM * 0.35, { loop: true });

  assert.ok(Math.hypot(start.x - wrapped.x, start.z - wrapped.z) < 1e-3);
  assert.ok(mid.eleM > start.eleM + 10);
  const tLen = Math.hypot(mid.tangent[0], mid.tangent[1], mid.tangent[2]);
  assert.ok(Math.abs(tLen - 1) < 1e-5);
});

test('buildRoadRibbonGeometry builds valid non-NaN buffers with upward-facing normals', () => {
  const route = getBuiltinRoute('rolling-parkrun-5k');
  const ribbon = buildRoadRibbonGeometry(route.samples, { widthM: 5.8, shoulderM: 1.0 });
  assert.equal(ribbon.vertexCount, route.samples.length * 4);
  assert.ok(ribbon.triangleCount > 100);
  for (let i = 0; i < Math.min(200, ribbon.positions.length); i += 1) {
    assert.ok(Number.isFinite(ribbon.positions[i]));
  }

  // Verify first triangle winding produces an upward (+Y) face normal so FrontSide does not cull it
  const i0 = ribbon.indices[0] * 3;
  const i1 = ribbon.indices[1] * 3;
  const i2 = ribbon.indices[2] * 3;
  const ax = ribbon.positions[i1] - ribbon.positions[i0];
  const ay = ribbon.positions[i1 + 1] - ribbon.positions[i0 + 1];
  const az = ribbon.positions[i1 + 2] - ribbon.positions[i0 + 2];
  const bx = ribbon.positions[i2] - ribbon.positions[i0];
  const by = ribbon.positions[i2 + 1] - ribbon.positions[i0 + 1];
  const bz = ribbon.positions[i2 + 2] - ribbon.positions[i0 + 2];
  const ny = az * bx - ax * bz;
  assert.ok(ny > 0, `Expected upward triangle normal (+Y), got ny=${ny}`);
});

test('computeUpcomingGradeAlert triggers on steepening/flattening and stays quiet on steady grade', () => {
  const route = getBuiltinRoute('box-hill-5k');

  // Approaching the steeper middle section of Box Hill climb (~22% of route) from flat 0%
  const climbDist = route.totalDistanceM * 0.22;
  const climbAlert = computeUpcomingGradeAlert(route, climbDist, {
    lookaheadM: 60,
    windowM: 40,
    lastAnnouncedPct: 0,
    minDeltaPct: 1.0,
  });
  assert.equal(climbAlert.shouldPrompt, true);
  assert.ok(climbAlert.targetInclinePct >= 1.5);
  assert.ok(climbAlert.promptText.includes('metres'));

  // Re-evaluating at same lastAnnouncedPct should NOT re-trigger
  const quietAlert = computeUpcomingGradeAlert(route, climbDist, {
    lookaheadM: 60,
    windowM: 40,
    lastAnnouncedPct: climbAlert.targetInclinePct,
    minDeltaPct: 1.0,
  });
  assert.equal(quietAlert.shouldPrompt, false);

  // Build custom short GPX error guard (< 2 pts throws)
  assert.throws(() => buildRouteFromGpx('<gpx><trk><trkseg></trkseg></trk></gpx>'), /at least 2/);
});
