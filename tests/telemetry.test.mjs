import test from 'node:test';
import assert from 'node:assert/strict';

import { parseRscMeasurement } from '../src/telemetry/rsc-client.js';
import { parseHeartRateMeasurement } from '../src/telemetry/hr-sensor.js';
import {
  TelemetryBus,
  computeHrZone,
  computePaceSecPerKm,
  formatDuration,
  formatPace,
} from '../src/telemetry/telemetry-bus.js';
import {
  YOUTUBE_RATES,
  mapSpeedToPlaybackRate,
  parseYoutubeVideoId,
} from '../src/views/view-manager.js';
import {
  FIT_SPORT_RUNNING,
  FIT_SUB_SPORT_TREADMILL,
  RunRecorder,
  fitCrc16,
} from '../src/export/fit-encoder.js';

test('parseRscMeasurement decodes minimal 4-byte packet and full packet with stride & distance', () => {
  // Minimal: flags=0x04 (running), speed=768 (3.0 m/s = 10.8 km/h), cadence=88 strides/min (176 spm)
  const minBuf = new Uint8Array(4);
  const minView = new DataView(minBuf.buffer);
  minView.setUint8(0, 0x04);
  minView.setUint16(1, 768, true);
  minView.setUint8(3, 88);

  const minRes = parseRscMeasurement(minBuf);
  assert.equal(minRes.isRunning, true);
  assert.equal(minRes.speedMps, 3.0);
  assert.ok(Math.abs(minRes.speedKph - 10.8) < 1e-6);
  assert.equal(minRes.cadenceStridesPerMin, 88);
  assert.equal(minRes.cadenceSpm, 176);
  assert.equal(minRes.strideLengthM, null);
  assert.equal(minRes.totalDistanceM, null);

  // Full: flags=0x07 (stride + total distance + running), speed=640 (2.5 m/s), cadence=85, stride=115 cm, dist=12345 dm
  const fullBuf = new Uint8Array(10);
  const fullView = new DataView(fullBuf.buffer);
  fullView.setUint8(0, 0x07);
  fullView.setUint16(1, 640, true);
  fullView.setUint8(3, 85);
  fullView.setUint16(4, 115, true);
  fullView.setUint32(6, 12345, true);

  const fullRes = parseRscMeasurement(fullBuf);
  assert.equal(fullRes.isRunning, true);
  assert.equal(fullRes.speedMps, 2.5);
  assert.equal(fullRes.cadenceSpm, 170);
  assert.equal(fullRes.strideLengthM, 1.15);
  assert.equal(fullRes.totalDistanceM, 1234.5);
});

test('parseHeartRateMeasurement decodes 8-bit BPM and RR intervals in ms', () => {
  // flags=0x16 (contact supported + detected, RR present), bpm=152, rr=[768 (750ms), 1024 (1000ms)]
  const buf = new Uint8Array(6);
  const view = new DataView(buf.buffer);
  view.setUint8(0, 0x16);
  view.setUint8(1, 152);
  view.setUint16(2, 768, true);
  view.setUint16(4, 1024, true);

  const res = parseHeartRateMeasurement(buf);
  assert.equal(res.bpm, 152);
  assert.equal(res.contactDetected, true);
  assert.equal(res.rrIntervalsMs.length, 2);
  assert.equal(res.rrIntervalsMs[0], 750);
  assert.equal(res.rrIntervalsMs[1], 1000);
});

test('TelemetryBus applies calibration, EMA smoothing, distance/elevation integration, and HR zones', () => {
  const bus = new TelemetryBus({ calibrationFactor: 1.0, emaTauSec: 2.0, maxHr: 180 });

  // 2.5 m/s = 9.0 km/h raw; sync to 9.9 km/h LCD -> 1.10x factor
  bus.ingestSpeed({ speedMps: 2.5, cadenceSpm: 172, inclinePct: 5.0, source: 'rsc' });
  const cal = bus.syncToTreadmillSpeed(9.9);
  assert.ok(cal !== null && Math.abs(cal - 1.1) < 1e-6);
  assert.ok(Math.abs(bus.state.speedKph - 9.9) < 1e-6);

  // While idle, stepping should advance EMA toward 9.9 km/h without integrating distance
  for (let i = 0; i < 10; i += 1) {
    bus.step(0.5);
  }
  assert.equal(bus.state.distanceM, 0);
  assert.ok(bus.state.smoothedSpeedKph > 9.0);

  // Start running for 10 seconds at 10.0 km/h (reset to exact 10 m/s? no, 10 km/h = 2.7778 m/s) and 4% incline
  bus.setCalibrationFactor(1.0);
  bus.ingestSpeed({ speedMps: 10 / 3.6, inclinePct: 4.0, source: 'rsc' });
  bus.setRecordingState('running');
  for (let i = 0; i < 10; i += 1) {
    bus.step(1.0);
  }
  assert.ok(Math.abs(bus.state.elapsedSec - 10) < 1e-6);
  assert.ok(Math.abs(bus.state.distanceM - (10 / 3.6) * 10) < 0.05);
  assert.ok(Math.abs(bus.state.elevationGainM - ((10 / 3.6) * 10 * 0.04)) < 0.02);

  // Negative incline does not subtract elevation gain
  bus.setInclinePct(-2.0);
  const elevBefore = bus.state.elevationGainM;
  bus.step(1.0);
  assert.equal(bus.state.elevationGainM, elevBefore);

  assert.equal(formatPace(computePaceSecPerKm(12)), '5:00');
  assert.equal(formatDuration(3665), '1:01:05');
  assert.equal(computeHrZone(153, 180)?.zone, 4); // 85% -> Z4
});

test('mapSpeedToPlaybackRate enforces YouTube hysteresis deadbands and pause-on-stop', () => {
  assert.deepEqual(YOUTUBE_RATES, [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0]);

  // Hysteresis around 1.0x <-> 1.25x at base 10 km/h (threshold 0.125 + 0.035 = 0.16)
  const stayAt1 = mapSpeedToPlaybackRate({ speedKph: 11.4, baseSpeedKph: 10, currentRate: 1.0, mode: 'discrete' });
  assert.equal(stayAt1.shouldPlay, true);
  assert.equal(stayAt1.rate, 1.0);

  const stepTo125 = mapSpeedToPlaybackRate({ speedKph: 11.7, baseSpeedKph: 10, currentRate: 1.0, mode: 'discrete' });
  assert.equal(stepTo125.rate, 1.25);

  const stayAt125 = mapSpeedToPlaybackRate({ speedKph: 11.1, baseSpeedKph: 10, currentRate: 1.25, mode: 'discrete' });
  assert.equal(stayAt125.rate, 1.25);

  const dropTo1 = mapSpeedToPlaybackRate({ speedKph: 10.8, baseSpeedKph: 10, currentRate: 1.25, mode: 'discrete' });
  assert.equal(dropTo1.rate, 1.0);

  // Auto-pause after 3s below 0.5 km/h
  const briefStop = mapSpeedToPlaybackRate({ speedKph: 0.2, stoppedSec: 1.5, currentRate: 1.0 });
  assert.equal(briefStop.shouldPlay, true);
  const pausedStop = mapSpeedToPlaybackRate({ speedKph: 0.2, stoppedSec: 3.1, currentRate: 1.0 });
  assert.equal(pausedStop.shouldPlay, false);

  // Continuous mode precision
  const cont = mapSpeedToPlaybackRate({ speedKph: 11.3, baseSpeedKph: 10, mode: 'continuous' });
  assert.equal(cont.shouldPlay, true);
  assert.equal(cont.rate, 1.13);

  // YouTube URL parser variants
  assert.equal(parseYoutubeVideoId('https://www.youtube.com/watch?v=h3E6n1s9r4M&t=42s'), 'h3E6n1s9r4M');
  assert.equal(parseYoutubeVideoId('https://youtu.be/21X5lGlDOfg?si=abc'), '21X5lGlDOfg');
  assert.equal(parseYoutubeVideoId('https://www.youtube.com/shorts/k3_tw44QsZQ'), 'k3_tw44QsZQ');
  assert.equal(parseYoutubeVideoId('lTRiuFIWV54'), 'lTRiuFIWV54');
  assert.equal(parseYoutubeVideoId('not-a-valid-id'), null);
});

test('RunRecorder builds valid Running/Treadmill .FIT binary with 1 km laps and distance reconciliation', () => {
  const startMs = Date.UTC(2026, 10, 26, 10, 0, 0);
  const recorder = new RunRecorder({ startTimeMs: startMs, autoLapDistanceM: 1000 });

  // Simulate 480 seconds at 10 m/s? No, 10 km/h = 2.7778 m/s -> let's run 864s at ~2.7778 m/s = 2400 m (2.4 km)
  const speedMps = 2400 / 864;
  for (let sec = 1; sec <= 864; sec += 1) {
    recorder.addSample({
      timestampMs: startMs + sec * 1000,
      distanceM: speedMps * sec,
      speedMps,
      cadenceSpm: 176,
      heartRateBpm: 150,
      altitudeM: (speedMps * sec) * 0.02,
      gradePct: 2.0,
    });
  }
  recorder.addHrv([400, 405, 398, 402, 401]);

  // Reconcile 2.40 km recorded distance to 2.50 km console distance (scale = 2.5 / 2.4)
  const built = recorder.buildFit({ actualDistanceKm: 2.5, endTimeMs: startMs + 864 * 1000 });
  const bytes = built.bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Header size (14), protocol 0x20, '.FIT' magic, header CRC, and trailing file CRC
  assert.equal(bytes[0], 14);
  assert.equal(bytes[1], 0x20);
  assert.equal(String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]), '.FIT');

  const dataSize = view.getUint32(4, true);
  assert.equal(bytes.length, 14 + dataSize + 2);
  assert.equal(view.getUint16(12, true), fitCrc16(bytes, 0, 12));
  assert.equal(view.getUint16(14 + dataSize, true), fitCrc16(bytes, 0, 14 + dataSize));

  // Verify scaling, auto-laps (2.5 km -> two 1 km laps + 1 final partial lap = 3 laps), and constants
  assert.equal(FIT_SPORT_RUNNING, 1);
  assert.equal(FIT_SUB_SPORT_TREADMILL, 1);
  assert.ok(Math.abs(built.scaleFactor - 2.5 / 2.4) < 1e-6);
  assert.ok(Math.abs(built.summary.distanceKm - 2.5) < 1e-4);
  assert.equal(built.summary.avgHr, 150);
  assert.equal(built.summary.laps, 3);
});
