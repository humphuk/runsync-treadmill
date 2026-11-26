import {
  TelemetryBus,
  computeHrZone,
  formatDuration,
  formatPace,
} from './telemetry/telemetry-bus.js';
import { RscClient } from './telemetry/rsc-client.js';
import { HeartRateClient } from './telemetry/hr-sensor.js';
import { SimAdapter } from './telemetry/sim-adapter.js';
import { ViewManager } from './views/view-manager.js';
import { YOUTUBE_PRESETS, YouTubeView } from './views/youtube-view.js';
import { LocalVideoView } from './views/local-video-view.js';
import { ThreeJsView } from './views/threejs-view.js';
import { RunRecorder } from './export/fit-encoder.js';
import { VoiceCoach } from './audio/voice-coach.js';

const SETTINGS_KEY = 'runsync_settings_v1';

const DEFAULT_SETTINGS = {
  calibrationFactor: 1.0,
  emaTauSec: 3.5,
  baseSpeedKph: 10.0,
  maxHr: 180,
  showHrZoneBar: false,
  voiceCoachEnabled: false,
  youtubeVideoId: YOUTUBE_PRESETS[0].id,
  activeView: 'youtube',
  muted: true,
  threeTheme: 'forest',
  threeQuality: 'low',
  threeCameraBob: true,
  ghostEnabled: true,
  ghostPaceSecPerKm: 330,
};

const LEGACY_PRESET_IDS = new Set([
  'h3E6n1s9r4M',
  '21X5lGlDOfg',
  'k3_tw44QsZQ',
  'lTRiuFIWV54',
]);

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }
    const merged = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    if (LEGACY_PRESET_IDS.has(merged.youtubeVideoId)) {
      merged.youtubeVideoId = YOUTUBE_PRESETS[0].id;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
    }
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors.
  }
}

const settings = loadSettings();

const bus = new TelemetryBus({
  calibrationFactor: settings.calibrationFactor,
  emaTauSec: settings.emaTauSec,
  maxHr: settings.maxHr,
});
const rscClient = new RscClient();
const hrClient = new HeartRateClient();
const simAdapter = new SimAdapter();
const recorder = new RunRecorder();
const voiceCoach = new VoiceCoach({ enabled: settings.voiceCoachEnabled });

const viewStage = document.getElementById('view-stage');
const viewManager = new ViewManager(viewStage);
const ytView = new YouTubeView({ videoId: settings.youtubeVideoId });
const localView = new LocalVideoView();
const threeView = new ThreeJsView({
  theme: settings.threeTheme,
  quality: settings.threeQuality,
  cameraBob: settings.threeCameraBob,
  ghostEnabled: settings.ghostEnabled,
  ghostPaceSecPerKm: settings.ghostPaceSecPerKm,
});
viewManager.register('youtube', ytView);
viewManager.register('local', localView);
viewManager.register('three', threeView);
viewManager.setMuted(settings.muted);
viewManager.setBaseSpeedKph(settings.baseSpeedKph);

// DOM References
const els = {
  chipRsc: document.getElementById('chip-rsc'),
  chipRscLabel: document.getElementById('chip-rsc-label'),
  chipHr: document.getElementById('chip-hr'),
  chipHrLabel: document.getElementById('chip-hr-label'),
  ratePill: document.getElementById('rate-pill'),
  ghostPill: document.getElementById('ghost-pill'),
  btnViewYoutube: document.getElementById('btn-view-youtube'),
  btnViewLocal: document.getElementById('btn-view-local'),
  btnViewThree: document.getElementById('btn-view-three'),
  btnMute: document.getElementById('btn-mute'),
  btnLockBase: document.getElementById('btn-lock-base'),
  btnDrawerToggle: document.getElementById('btn-drawer-toggle'),
  btnDrawerClose: document.getElementById('btn-drawer-close'),
  drawer: document.getElementById('setup-drawer'),
  hrZoneBar: document.getElementById('hr-zone-bar'),

  hudPace: document.getElementById('hud-pace'),
  hudSpeed: document.getElementById('hud-speed'),
  hudHr: document.getElementById('hud-hr'),
  hudHrZone: document.getElementById('hud-hr-zone'),
  hudCadence: document.getElementById('hud-cadence'),
  hudDistance: document.getElementById('hud-distance'),
  hudTime: document.getElementById('hud-time'),
  hudElev: document.getElementById('hud-elev'),
  hudIncline: document.getElementById('hud-incline'),

  btnIncDown: document.getElementById('btn-inc-down'),
  btnIncUp: document.getElementById('btn-inc-up'),
  btnRunToggle: document.getElementById('btn-run-toggle'),
  btnRunFinish: document.getElementById('btn-run-finish'),

  btnConnectRsc: document.getElementById('btn-connect-rsc'),
  btnConnectHr: document.getElementById('btn-connect-hr'),
  statusRscDetail: document.getElementById('status-rsc-detail'),
  statusHrDetail: document.getElementById('status-hr-detail'),
  bleWarning: document.getElementById('ble-warning'),

  toggleSim: document.getElementById('toggle-sim'),
  simControls: document.getElementById('sim-controls'),
  simSpeed: document.getElementById('sim-speed'),
  simSpeedVal: document.getElementById('sim-speed-val'),
  simIncline: document.getElementById('sim-incline'),
  simInclineVal: document.getElementById('sim-incline-val'),
  simHr: document.getElementById('sim-hr'),
  simHrVal: document.getElementById('sim-hr-val'),
  toggleSimDemo: document.getElementById('toggle-sim-demo'),

  ytPreset: document.getElementById('yt-preset'),
  ytCustomUrl: document.getElementById('yt-custom-url'),
  btnYtLoad: document.getElementById('btn-yt-load'),
  localVideoInput: document.getElementById('local-video-input'),
  btnPickLocal: document.getElementById('btn-pick-local'),
  localVideoName: document.getElementById('local-video-name'),
  baseSpeed: document.getElementById('base-speed'),
  baseSpeedVal: document.getElementById('base-speed-val'),
  btnDrawerLockBase: document.getElementById('btn-drawer-lock-base'),

  threeTheme: document.getElementById('three-theme'),
  threeQuality: document.getElementById('three-quality'),
  toggleThreeBob: document.getElementById('toggle-three-bob'),
  toggleGhost: document.getElementById('toggle-ghost'),
  ghostPace: document.getElementById('ghost-pace'),
  ghostPaceVal: document.getElementById('ghost-pace-val'),

  calFactorVal: document.getElementById('cal-factor-val'),
  btnCalReset: document.getElementById('btn-cal-reset'),
  calLcdKph: document.getElementById('cal-lcd-kph'),
  btnCalSync: document.getElementById('btn-cal-sync'),
  emaTau: document.getElementById('ema-tau'),
  emaTauVal: document.getElementById('ema-tau-val'),
  maxHr: document.getElementById('max-hr'),
  maxHrVal: document.getElementById('max-hr-val'),
  toggleHrZoneBar: document.getElementById('toggle-hr-zone-bar'),
  toggleVoiceCoach: document.getElementById('toggle-voice-coach'),

  finishModal: document.getElementById('finish-modal'),
  sumTime: document.getElementById('sum-time'),
  sumDistance: document.getElementById('sum-distance'),
  sumPace: document.getElementById('sum-pace'),
  sumHr: document.getElementById('sum-hr'),
  sumElev: document.getElementById('sum-elev'),
  sumLaps: document.getElementById('sum-laps'),
  finishActualKm: document.getElementById('finish-actual-km'),
  finishUpdateCal: document.getElementById('finish-update-cal'),
  btnModalDiscard: document.getElementById('btn-modal-discard'),
  btnModalResume: document.getElementById('btn-modal-resume'),
  btnModalDownload: document.getElementById('btn-modal-download'),
};

// Wake Lock management
let wakeLock = null;
async function requestWakeLock() {
  if (!('wakeLock' in navigator) || wakeLock) {
    return;
  }
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
    });
  } catch {
    // Ignore wake lock rejection.
  }
}

async function releaseWakeLock() {
  if (!wakeLock) {
    return;
  }
  try {
    await wakeLock.release();
  } catch {
    // Ignore release errors.
  }
  wakeLock = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && bus.state.recordingState === 'running') {
    requestWakeLock();
  }
});

// Populate YouTube presets
for (const preset of YOUTUBE_PRESETS) {
  const opt = document.createElement('option');
  opt.value = preset.id;
  opt.textContent = preset.title;
  els.ytPreset.appendChild(opt);
}
if (YOUTUBE_PRESETS.some((p) => p.id === settings.youtubeVideoId)) {
  els.ytPreset.value = settings.youtubeVideoId;
}

// Initialize controls from saved settings
els.baseSpeed.value = String(settings.baseSpeedKph);
els.baseSpeedVal.textContent = settings.baseSpeedKph.toFixed(1);
els.calFactorVal.textContent = `${settings.calibrationFactor.toFixed(3)}×`;
els.emaTau.value = String(settings.emaTauSec);
els.emaTauVal.textContent = settings.emaTauSec.toFixed(1);
els.maxHr.value = String(settings.maxHr);
els.maxHrVal.textContent = String(settings.maxHr);
els.toggleHrZoneBar.checked = settings.showHrZoneBar;
els.hrZoneBar.classList.toggle('hidden', !settings.showHrZoneBar);
els.toggleVoiceCoach.checked = settings.voiceCoachEnabled;
els.btnMute.textContent = settings.muted ? 'Muted' : 'Audio On';
els.threeTheme.value = settings.threeTheme;
els.threeQuality.value = settings.threeQuality;
els.toggleThreeBob.checked = settings.threeCameraBob;
els.toggleGhost.checked = settings.ghostEnabled;
els.ghostPace.value = String(settings.ghostPaceSecPerKm);
els.ghostPaceVal.textContent = formatPace(settings.ghostPaceSecPerKm);

if (!navigator.bluetooth) {
  els.bleWarning.textContent =
    'Web Bluetooth unavailable here. Open via HTTPS (GitHub Pages) or localhost in Chrome, or enable Desk Simulator below.';
  els.bleWarning.classList.remove('hidden');
}

// Sensor bindings
rscClient.addEventListener('rsc', (e) => {
  if (simAdapter.active) {
    return;
  }
  bus.ingestSpeed({
    speedMps: e.detail.speedMps,
    cadenceSpm: e.detail.cadenceSpm,
    source: 'rsc',
    applyCalibration: true,
  });
});

rscClient.addEventListener('status', (e) => {
  const { state, message } = e.detail;
  els.statusRscDetail.textContent = message;
  els.chipRsc.classList.remove('connected', 'connecting');
  if (state === 'connected') {
    els.chipRsc.classList.add('connected');
    els.chipRscLabel.textContent = `Pod: ${rscClient.device?.name || 'On'}`;
    els.btnConnectRsc.textContent = 'Disconnect';
  } else if (state === 'connecting' || state === 'requesting') {
    els.chipRsc.classList.add('connecting');
    els.chipRscLabel.textContent = 'Pod: ...';
  } else {
    els.chipRscLabel.textContent = 'Pod: Off';
    els.btnConnectRsc.textContent = 'Connect';
  }
});

hrClient.addEventListener('hr', (e) => {
  if (simAdapter.active) {
    return;
  }
  bus.ingestHeartRate({ bpm: e.detail.bpm });
  if (bus.state.recordingState === 'running' && e.detail.rrIntervalsMs?.length) {
    recorder.addHrv(e.detail.rrIntervalsMs);
  }
});

hrClient.addEventListener('status', (e) => {
  const { state, message } = e.detail;
  els.statusHrDetail.textContent = message;
  els.chipHr.classList.remove('connected', 'connecting');
  if (state === 'connected') {
    els.chipHr.classList.add('connected');
    els.chipHrLabel.textContent = `HR: ${hrClient.device?.name || 'On'}`;
    els.btnConnectHr.textContent = 'Disconnect';
  } else if (state === 'connecting' || state === 'requesting') {
    els.chipHr.classList.add('connecting');
    els.chipHrLabel.textContent = 'HR: ...';
  } else {
    els.chipHrLabel.textContent = 'HR: Off';
    els.btnConnectHr.textContent = 'Connect';
  }
});

simAdapter.addEventListener('speed', (e) => {
  bus.ingestSpeed({
    speedMps: e.detail.speedMps,
    cadenceSpm: e.detail.cadenceSpm,
    inclinePct: e.detail.inclinePct,
    source: 'sim',
    applyCalibration: false,
  });
  els.simSpeed.value = String(e.detail.speedKph);
  els.simSpeedVal.textContent = e.detail.speedKph.toFixed(1);
  els.simIncline.value = String(e.detail.inclinePct);
  els.simInclineVal.textContent = e.detail.inclinePct.toFixed(1);
});

simAdapter.addEventListener('hr', (e) => {
  bus.ingestHeartRate({ bpm: e.detail.bpm });
  els.simHr.value = String(e.detail.bpm);
  els.simHrVal.textContent = String(e.detail.bpm);
  if (bus.state.recordingState === 'running' && e.detail.rrIntervalsMs?.length) {
    recorder.addHrv(e.detail.rrIntervalsMs);
  }
});

async function toggleRscConnection() {
  if (rscClient.isConnected) {
    await rscClient.disconnect();
    return;
  }
  try {
    await rscClient.connect();
  } catch (err) {
    els.statusRscDetail.textContent = err.message || 'Connection cancelled';
  }
}

async function toggleHrConnection() {
  if (hrClient.isConnected) {
    await hrClient.disconnect();
    return;
  }
  try {
    await hrClient.connect();
  } catch (err) {
    els.statusHrDetail.textContent = err.message || 'Connection cancelled';
  }
}

els.btnConnectRsc.addEventListener('click', toggleRscConnection);
els.chipRsc.addEventListener('click', toggleRscConnection);
els.btnConnectHr.addEventListener('click', toggleHrConnection);
els.chipHr.addEventListener('click', toggleHrConnection);

// Drawer controls
function setDrawerOpen(open) {
  els.drawer.classList.toggle('open', open);
  els.drawer.setAttribute('aria-hidden', String(!open));
}

els.btnDrawerToggle.addEventListener('click', () => {
  setDrawerOpen(!els.drawer.classList.contains('open'));
});
els.btnDrawerClose.addEventListener('click', () => setDrawerOpen(false));

// Simulator controls
els.toggleSim.addEventListener('change', () => {
  if (els.toggleSim.checked) {
    els.simControls.classList.remove('disabled');
    simAdapter.start();
    els.chipRscLabel.textContent = 'Pod: Sim';
    els.chipHrLabel.textContent = 'HR: Sim';
  } else {
    simAdapter.stop();
    els.simControls.classList.add('disabled');
    bus.ingestSpeed({ speedMps: 0, cadenceSpm: 0, source: 'idle', applyCalibration: false });
    bus.ingestHeartRate({ bpm: null });
    els.chipRscLabel.textContent = rscClient.isConnected ? `Pod: ${rscClient.device?.name || 'On'}` : 'Pod: Off';
    els.chipHrLabel.textContent = hrClient.isConnected ? `HR: ${hrClient.device?.name || 'On'}` : 'HR: Off';
  }
});

function pushSimSliders() {
  simAdapter.setValues({
    speedKph: Number(els.simSpeed.value),
    inclinePct: Number(els.simIncline.value),
    hrBpm: Number(els.simHr.value),
  });
}

els.simSpeed.addEventListener('input', pushSimSliders);
els.simIncline.addEventListener('input', pushSimSliders);
els.simHr.addEventListener('input', pushSimSliders);
els.toggleSimDemo.addEventListener('change', () => {
  simAdapter.setIntervalDemo(els.toggleSimDemo.checked);
});

// View switching & video controls
async function setViewMode(mode) {
  await viewManager.switchTo(mode);
  settings.activeView = mode;
  saveSettings(settings);
  const isThree = mode === 'three';
  els.btnViewYoutube.classList.toggle('active', mode === 'youtube');
  els.btnViewLocal.classList.toggle('active', mode === 'local');
  els.btnViewThree.classList.toggle('active', isThree);
  els.ratePill.classList.toggle('hidden', isThree);
  els.btnMute.classList.toggle('hidden', isThree);
  els.btnLockBase.classList.toggle('hidden', isThree);
  els.ghostPill.classList.toggle('hidden', !isThree || !settings.ghostEnabled);
}

els.btnViewYoutube.addEventListener('click', () => setViewMode('youtube'));
els.btnViewLocal.addEventListener('click', () => setViewMode('local'));
els.btnViewThree.addEventListener('click', () => setViewMode('three'));

// Phase 2A 3D World controls
threeView.addEventListener('ghostupdate', (e) => {
  const { enabled, gapM } = e.detail;
  els.ghostPill.classList.toggle('hidden', settings.activeView !== 'three' || !enabled);
  els.ghostPill.classList.remove('ahead', 'behind');
  if (!enabled) {
    return;
  }
  const rounded = Math.round(Math.abs(gapM));
  if (rounded < 1) {
    els.ghostPill.textContent = 'Ghost: Level';
  } else if (gapM > 0) {
    els.ghostPill.textContent = `Ghost +${rounded} m`;
    els.ghostPill.classList.add('behind');
  } else {
    els.ghostPill.textContent = `Ahead +${rounded} m`;
    els.ghostPill.classList.add('ahead');
  }
});

els.threeTheme.addEventListener('change', () => {
  settings.threeTheme = els.threeTheme.value;
  threeView.setTheme(settings.threeTheme);
  saveSettings(settings);
});

els.threeQuality.addEventListener('change', () => {
  settings.threeQuality = els.threeQuality.value;
  threeView.setQuality(settings.threeQuality);
  saveSettings(settings);
});

els.toggleThreeBob.addEventListener('change', () => {
  settings.threeCameraBob = els.toggleThreeBob.checked;
  threeView.setCameraBob(settings.threeCameraBob);
  saveSettings(settings);
});

els.toggleGhost.addEventListener('change', () => {
  settings.ghostEnabled = els.toggleGhost.checked;
  threeView.setGhostConfig({ enabled: settings.ghostEnabled });
  els.ghostPill.classList.toggle('hidden', settings.activeView !== 'three' || !settings.ghostEnabled);
  saveSettings(settings);
});

els.ghostPace.addEventListener('input', () => {
  const paceSec = Number(els.ghostPace.value);
  settings.ghostPaceSecPerKm = paceSec;
  els.ghostPaceVal.textContent = formatPace(paceSec);
  threeView.setGhostConfig({ paceSecPerKm: paceSec });
  saveSettings(settings);
});

els.btnMute.addEventListener('click', () => {
  settings.muted = !settings.muted;
  viewManager.setMuted(settings.muted);
  els.btnMute.textContent = settings.muted ? 'Muted' : 'Audio On';
  saveSettings(settings);
});

function updateBaseSpeed(kph) {
  const clamped = Math.min(18, Math.max(5, Math.round(kph * 2) / 2));
  settings.baseSpeedKph = clamped;
  viewManager.setBaseSpeedKph(clamped);
  els.baseSpeed.value = String(clamped);
  els.baseSpeedVal.textContent = clamped.toFixed(1);
  saveSettings(settings);
}

function lockCurrentAsBase() {
  const current = bus.state.speedKph;
  if (current < 1.0) {
    return;
  }
  updateBaseSpeed(current);
}

els.baseSpeed.addEventListener('input', () => updateBaseSpeed(Number(els.baseSpeed.value)));
els.btnLockBase.addEventListener('click', lockCurrentAsBase);
els.btnDrawerLockBase.addEventListener('click', lockCurrentAsBase);

ytView.addEventListener('ratechange', (e) => {
  els.ratePill.textContent = `${e.detail.rate.toFixed(2)}×`;
});
localView.addEventListener('ratechange', (e) => {
  els.ratePill.textContent = `${e.detail.rate.toFixed(2)}×`;
});
localView.addEventListener('requestfile', () => els.localVideoInput.click());
localView.addEventListener('fileloaded', (e) => {
  els.localVideoName.textContent = e.detail.name;
});

els.ytPreset.addEventListener('change', () => {
  const id = els.ytPreset.value;
  if (ytView.setVideo(id)) {
    settings.youtubeVideoId = id;
    saveSettings(settings);
  }
});

els.btnYtLoad.addEventListener('click', () => {
  if (ytView.setVideo(els.ytCustomUrl.value)) {
    settings.youtubeVideoId = ytView.videoId;
    saveSettings(settings);
    setViewMode('youtube');
  }
});

els.btnPickLocal.addEventListener('click', () => els.localVideoInput.click());
els.localVideoInput.addEventListener('change', () => {
  const file = els.localVideoInput.files?.[0];
  if (file) {
    localView.loadFile(file);
    setViewMode('local');
  }
});

// Calibration & Preferences
function applyCalibration(factor) {
  const applied = bus.setCalibrationFactor(factor);
  settings.calibrationFactor = applied;
  els.calFactorVal.textContent = `${applied.toFixed(3)}×`;
  saveSettings(settings);
}

els.btnCalSync.addEventListener('click', () => {
  const target = Number(els.calLcdKph.value);
  const nextFactor = bus.syncToTreadmillSpeed(target);
  if (nextFactor !== null) {
    applyCalibration(nextFactor);
  }
});
els.btnCalReset.addEventListener('click', () => applyCalibration(1.0));

els.emaTau.addEventListener('input', () => {
  const val = Number(els.emaTau.value);
  settings.emaTauSec = val;
  bus.setEmaTauSec(val);
  els.emaTauVal.textContent = val.toFixed(1);
  saveSettings(settings);
});

els.maxHr.addEventListener('input', () => {
  const val = Number(els.maxHr.value);
  settings.maxHr = val;
  bus.setMaxHr(val);
  els.maxHrVal.textContent = String(val);
  saveSettings(settings);
});

els.toggleHrZoneBar.addEventListener('change', () => {
  settings.showHrZoneBar = els.toggleHrZoneBar.checked;
  els.hrZoneBar.classList.toggle('hidden', !settings.showHrZoneBar);
  saveSettings(settings);
});

els.toggleVoiceCoach.addEventListener('change', () => {
  settings.voiceCoachEnabled = els.toggleVoiceCoach.checked;
  voiceCoach.setEnabled(settings.voiceCoachEnabled);
  saveSettings(settings);
});

// Manual Incline +/-
els.btnIncDown.addEventListener('click', () => {
  bus.adjustInclinePct(-0.5);
  renderHud(bus.getSnapshot());
});
els.btnIncUp.addEventListener('click', () => {
  bus.adjustInclinePct(0.5);
  renderHud(bus.getSnapshot());
});

// Run Lifecycle (Start / Pause / Finish & .FIT)
function updateRunButtons(recState) {
  if (recState === 'running') {
    els.btnRunToggle.textContent = 'Pause';
    els.btnRunFinish.disabled = false;
  } else if (recState === 'paused') {
    els.btnRunToggle.textContent = 'Resume';
    els.btnRunFinish.disabled = false;
  } else {
    els.btnRunToggle.textContent = 'Start';
    els.btnRunFinish.disabled = true;
  }
}

els.btnRunToggle.addEventListener('click', () => {
  const current = bus.state.recordingState;
  if (current === 'idle') {
    recorder.reset(Date.now());
    voiceCoach.reset(0);
    bus.resetRun();
    bus.setRecordingState('running');
    viewManager.setManualPaused(false);
    requestWakeLock();
  } else if (current === 'running') {
    bus.setRecordingState('paused');
    viewManager.setManualPaused(true);
  } else if (current === 'paused') {
    bus.setRecordingState('running');
    viewManager.setManualPaused(false);
    requestWakeLock();
  }
  updateRunButtons(bus.state.recordingState);
});

let lastFinishReport = null;

function openFinishModal() {
  bus.setRecordingState('paused');
  viewManager.setManualPaused(true);
  updateRunButtons('paused');
  releaseWakeLock();

  lastFinishReport = recorder.buildFit({ endTimeMs: Date.now() });
  const { summary } = lastFinishReport;
  els.sumTime.textContent = formatDuration(summary.elapsedSec);
  els.sumDistance.textContent = `${summary.distanceKm.toFixed(2)} km`;
  els.sumPace.textContent =
    summary.avgSpeedKph >= 0.5 ? `${formatPace(3600 / summary.avgSpeedKph)} /km` : '--:-- /km';
  els.sumHr.textContent =
    summary.avgHr !== null ? `${summary.avgHr} / ${summary.maxHr} bpm` : '-- / --';
  els.sumElev.textContent = `+${Math.round(summary.elevationGainM)} m`;
  els.sumLaps.textContent = String(summary.laps);
  els.finishActualKm.value = '';
  els.finishModal.classList.remove('hidden');
}

els.btnRunFinish.addEventListener('click', openFinishModal);

els.btnModalResume.addEventListener('click', () => {
  els.finishModal.classList.add('hidden');
  bus.setRecordingState('running');
  viewManager.setManualPaused(false);
  updateRunButtons('running');
  requestWakeLock();
});

els.btnModalDiscard.addEventListener('click', () => {
  els.finishModal.classList.add('hidden');
  recorder.reset(Date.now());
  voiceCoach.reset(0);
  bus.resetRun();
  viewManager.setManualPaused(false);
  updateRunButtons('idle');
  renderHud(bus.getSnapshot());
});

els.btnModalDownload.addEventListener('click', () => {
  const actualKmInput = Number(els.finishActualKm.value);
  const actualDistanceKm =
    Number.isFinite(actualKmInput) && actualKmInput > 0 ? actualKmInput : null;

  const built = recorder.buildFit({ actualDistanceKm, endTimeMs: Date.now() });
  if (actualDistanceKm !== null && els.finishUpdateCal.checked && built.scaleFactor !== 1.0) {
    applyCalibration(settings.calibrationFactor * built.scaleFactor);
  }

  const blob = new Blob([built.bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `runsync-treadmill-${stamp}.fit`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);

  els.finishModal.classList.add('hidden');
  recorder.reset(Date.now());
  voiceCoach.reset(0);
  bus.resetRun();
  viewManager.setManualPaused(false);
  updateRunButtons('idle');
  renderHud(bus.getSnapshot());
});

// HUD Renderer (4 Hz throttled)
function renderHud(state) {
  els.hudPace.textContent = formatPace(state.paceSecPerKm);
  els.hudSpeed.textContent = state.speedKph.toFixed(1);
  els.hudHr.textContent = state.heartRateBpm !== null ? String(state.heartRateBpm) : '--';
  els.hudCadence.textContent = state.cadenceSpm !== null ? String(state.cadenceSpm) : '--';
  els.hudDistance.textContent = (state.distanceM / 1000).toFixed(2);
  els.hudTime.textContent = formatDuration(state.elapsedSec);
  els.hudElev.textContent = String(Math.round(state.elevationGainM));
  els.hudIncline.textContent = `${state.inclinePct.toFixed(1)}%`;

  const zoneInfo = computeHrZone(state.heartRateBpm, settings.maxHr);
  if (zoneInfo) {
    els.hudHrZone.textContent = `Z${zoneInfo.zone}`;
    els.hudHrZone.classList.remove('hidden');
  } else {
    els.hudHrZone.classList.add('hidden');
  }

  if (settings.showHrZoneBar) {
    const segs = els.hrZoneBar.querySelectorAll('.hr-zone-seg');
    for (const seg of segs) {
      const z = Number(seg.getAttribute('data-zone'));
      seg.classList.toggle('active', Boolean(zoneInfo && zoneInfo.zone === z));
    }
  }
}

// Main Simulation & Recording Loop (10 Hz telemetry, 4 Hz HUD, 1 Hz FIT sample)
let lastTickMs = performance.now();
let hudAccumSec = 0;
let recordAccumSec = 0;

setInterval(() => {
  const nowPerf = performance.now();
  const dt = Math.min(0.5, Math.max(0.01, (nowPerf - lastTickMs) / 1000));
  lastTickMs = nowPerf;

  const snap = bus.step(dt);
  viewManager.update(snap, dt);
  voiceCoach.onTelemetry(snap);

  if (snap.recordingState === 'running') {
    recordAccumSec += dt;
    if (recordAccumSec >= 1.0) {
      recordAccumSec -= 1.0;
      recorder.addSample({
        timestampMs: Date.now(),
        distanceM: snap.distanceM,
        speedMps: snap.speedMps,
        cadenceSpm: snap.cadenceSpm,
        heartRateBpm: snap.heartRateBpm,
        altitudeM: snap.elevationGainM,
        gradePct: snap.inclinePct,
      });
    }
  }

  hudAccumSec += dt;
  if (hudAccumSec >= 0.25) {
    hudAccumSec = 0;
    renderHud(snap);
  }
}, 100);

// Mount initial view & register Service Worker
const initialView = ['youtube', 'local', 'three'].includes(settings.activeView)
  ? settings.activeView
  : 'youtube';
setViewMode(initialView).catch(() => {});
renderHud(bus.getSnapshot());
updateRunButtons(bus.state.recordingState);

if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
