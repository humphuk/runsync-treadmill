import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WORLD_THEMES,
  computeInclinePitchRad,
  computeNextArchDistanceM,
  computeRoadYAtZ,
  computeStrideBobOffset,
  updateGhostPacer,
  wrapScrollZ,
} from '../src/views/threejs-math.js';

test('WORLD_THEMES provides forest, coastal, and synthwave palettes with required fields', () => {
  for (const key of ['forest', 'coastal', 'synthwave']) {
    const theme = WORLD_THEMES[key];
    assert.ok(theme, `Missing theme ${key}`);
    assert.ok(theme.skyTop && theme.skyHorizon && theme.fogColor);
    assert.ok(theme.roadBase && theme.roadStripe && theme.archColor && theme.ghostColor);
  }
});

test('computeInclinePitchRad and computeRoadYAtZ produce positive uphill lift and clamp bounds', () => {
  assert.equal(computeInclinePitchRad(0), 0);
  assert.equal(computeRoadYAtZ(100, 0), 0);

  const pitch5 = computeInclinePitchRad(5);
  assert.ok(pitch5 > 0);
  const yAt100 = computeRoadYAtZ(100, 5);
  assert.ok(yAt100 > 5 && yAt100 < 10);

  // Clamping at +20% max and -5% min
  assert.equal(computeInclinePitchRad(35), computeInclinePitchRad(20));
  assert.equal(computeInclinePitchRad(-15), computeInclinePitchRad(-5));
});

test('computeStrideBobOffset is zero when disabled or stopped and bounded when running', () => {
  assert.deepEqual(computeStrideBobOffset(1.2, 10, false), { x: 0, y: 0 });
  assert.deepEqual(computeStrideBobOffset(1.2, 0.2, true), { x: 0, y: 0 });

  const bob = computeStrideBobOffset(Math.PI / 4, 10.5, true);
  assert.ok(Math.abs(bob.y) > 0 && Math.abs(bob.y) <= 0.045);
  assert.ok(Math.abs(bob.x) > 0 && Math.abs(bob.x) <= 0.02);
});

test('wrapScrollZ wraps across multiple spans cleanly', () => {
  assert.equal(wrapScrollZ(10, 5, 240, 18), 15);
  assert.equal(wrapScrollZ(10, 20, 240, 18), 30 - 240);
  assert.equal(wrapScrollZ(-220, -10, 240, 18), -230 + 240);
});

test('computeNextArchDistanceM returns next 500m milestone strictly ahead of runner', () => {
  assert.equal(computeNextArchDistanceM(0, 500), 500);
  assert.equal(computeNextArchDistanceM(499.9, 500), 500);
  assert.equal(computeNextArchDistanceM(500, 500), 1000);
  assert.equal(computeNextArchDistanceM(1230, 500), 1500);
});

test('updateGhostPacer tracks ahead/behind gaps and visibility range', () => {
  // Pace 300 s/km = 5:00/km -> 3.3333 m/s. After 60s -> ghost at 200m.
  const ghostAhead = updateGhostPacer({
    runnerDistanceM: 185,
    targetPaceSecPerKm: 300,
    elapsedSec: 60,
    enabled: true,
  });
  assert.equal(ghostAhead.enabled, true);
  assert.ok(Math.abs(ghostAhead.ghostDistanceM - 200) < 1e-6);
  assert.ok(Math.abs(ghostAhead.gapM - 15) < 1e-6);
  assert.ok(Math.abs(ghostAhead.gapSec - 4.5) < 1e-6);
  assert.equal(ghostAhead.visibleInRange, true);
  assert.ok(ghostAhead.zOffset < 0);

  // Runner ahead of ghost by 200m -> out of 185m visibility range
  const runnerFarAhead = updateGhostPacer({
    runnerDistanceM: 400,
    targetPaceSecPerKm: 300,
    elapsedSec: 60,
    enabled: true,
  });
  assert.ok(runnerFarAhead.gapM < -199);
  assert.equal(runnerFarAhead.visibleInRange, false);

  // Disabled
  const off = updateGhostPacer({ runnerDistanceM: 100, elapsedSec: 30, enabled: false });
  assert.equal(off.visibleInRange, false);
});
