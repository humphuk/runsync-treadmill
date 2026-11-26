/**
 * Lightweight Three.js 3D Runner View (Phase 2A) tuned for the Lenovo Duet GPU budget:
 * - devicePixelRatio <= 1, shadowMap disabled, distance fog, < 15 draw calls via InstancedMesh
 * - Stationary camera at z = 0 with pooled scrolling chunks (zero long-run jitter)
 * - 3 offline themes (Forest Trail, Coastal Sunset, Synthwave Grid)
 * - Dynamic incline road pitch, 500 m milestone arches, toggleable stride bob, and Ghost Pacer
 */

import * as THREE from '../../vendor/three.module.min.js';
import {
  WORLD_THEMES,
  computeInclinePitchRad,
  computeNextArchDistanceM,
  computeStrideBobOffset,
  updateGhostPacer,
  wrapScrollZ,
} from './threejs-math.js';

const MAX_SCENERY = 180;
const SCROLL_SPAN_M = 240;
const SCROLL_NEAR_Z = 18;
const ROAD_TILE_METERS = 10;

function seededRand(seed) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function createSkyTexture(theme) {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, theme.skyTop);
  grad.addColorStop(0.68, theme.skyHorizon);
  grad.addColorStop(1, theme.fogColor);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createRoadTexture(theme) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = theme.roadBase;
  ctx.fillRect(0, 0, 256, 256);

  // Subtle surface grain
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  for (let i = 0; i < 90; i += 1) {
    const rx = seededRand(i + 1) * 256;
    const ry = seededRand(i + 91) * 256;
    ctx.fillRect(rx, ry, 3, 4);
  }

  // Shoulder lines
  ctx.fillStyle = theme.roadShoulder;
  ctx.fillRect(10, 0, 8, 256);
  ctx.fillRect(238, 0, 8, 256);

  // Center dashed line
  ctx.fillStyle = theme.roadStripe;
  ctx.fillRect(124, 20, 8, 96);
  ctx.fillRect(124, 148, 8, 96);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, SCROLL_SPAN_M / ROAD_TILE_METERS);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createArchSignTexture(labelText, accentColor) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0b1020';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, 496, 112);

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 58px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(labelText, 256, 66);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class ThreeJsView extends EventTarget {
  constructor({
    theme = 'forest',
    quality = 'low',
    cameraBob = true,
    ghostEnabled = true,
    ghostPaceSecPerKm = 330,
  } = {}) {
    super();
    this.themeKey = WORLD_THEMES[theme] ? theme : 'forest';
    this.quality = quality === 'medium' ? 'medium' : 'low';
    this.cameraBob = Boolean(cameraBob);
    this.ghostEnabled = Boolean(ghostEnabled);
    this.ghostPaceSecPerKm = ghostPaceSecPerKm;
    this.manualPaused = false;

    this.container = null;
    this._mounted = false;
    this._rafId = null;
    this._resizeObserver = null;
    this._lastFrameMs = 0;

    this._latestTelemetry = {
      speedMps: 0,
      speedKph: 0,
      smoothedSpeedKph: 0,
      inclinePct: 0,
      distanceM: 0,
      elapsedSec: 0,
      cadenceSpm: 165,
      recordingState: 'idle',
    };

    this._pitchRad = 0;
    this._stridePhase = 0;
    this._ghostPhase = 0;
    this._lastGhostEmitMs = 0;
    this._nextArchM = 500;
    this._disposables = [];

    // Three.js handles
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.worldGroup = null;
    this.ambientLight = null;
    this.sunLight = null;
    this.sunMesh = null;
    this.roadMesh = null;
    this.roadTex = null;
    this.skyTex = null;
    this.terrainGeo = null;
    this.terrainMesh = null;
    this.trunkMesh = null;
    this.canopyMesh = null;
    this.propMesh = null;
    this.archGroup = null;
    this.archSignMat = null;
    this.archSignTex = null;
    this.archMat = null;
    this.ghostGroup = null;
    this.ghostParts = null;
    this.ghostMat = null;
    this._scenerySlots = [];
    this._dummy = new THREE.Object3D();
  }

  async mount(container, { manualPaused = false } = {}) {
    this._mounted = true;
    this.container = container;
    this.manualPaused = manualPaused;
    container.innerHTML = '';

    const stage = document.createElement('div');
    stage.className = 'video-stage three-stage';
    container.appendChild(stage);

    try {
      this._initScene(stage);
    } catch (err) {
      const banner = document.createElement('div');
      banner.className = 'view-banner warn';
      banner.textContent = `WebGL 3D view unavailable (${err.message}). Switch to YouTube or Local MP4.`;
      stage.appendChild(banner);
      return;
    }

    this._lastFrameMs = performance.now();
    const tick = (now) => {
      if (!this._mounted) {
        return;
      }
      const dt = Math.min(0.1, Math.max(0.001, (now - this._lastFrameMs) / 1000));
      this._lastFrameMs = now;
      this._renderFrame(dt, now);
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  async unmount() {
    this._mounted = false;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    for (const item of this._disposables) {
      try {
        item.dispose();
      } catch {
        // Ignore disposal error.
      }
    }
    this._disposables = [];
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
    this.scene = null;
    this.camera = null;
    this.worldGroup = null;
    this._scenerySlots = [];
    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
    }
  }

  setManualPaused(paused) {
    this.manualPaused = Boolean(paused);
  }

  setTheme(themeKey) {
    if (!WORLD_THEMES[themeKey]) {
      return;
    }
    this.themeKey = themeKey;
    if (this.scene) {
      this._applyTheme();
    }
  }

  setQuality(quality) {
    this.quality = quality === 'medium' ? 'medium' : 'low';
    if (!this.renderer) {
      return;
    }
    this.renderer.setPixelRatio(this.quality === 'medium' ? Math.min(window.devicePixelRatio || 1, 1) : 0.85);
    const activeCount = this.quality === 'medium' ? MAX_SCENERY : 100;
    if (this.trunkMesh) this.trunkMesh.count = activeCount;
    if (this.canopyMesh) this.canopyMesh.count = activeCount;
    if (this.propMesh) this.propMesh.count = activeCount;
    this._handleResize();
  }

  setCameraBob(enabled) {
    this.cameraBob = Boolean(enabled);
  }

  setGhostConfig({ enabled, paceSecPerKm } = {}) {
    if (typeof enabled === 'boolean') {
      this.ghostEnabled = enabled;
    }
    if (typeof paceSecPerKm === 'number' && Number.isFinite(paceSecPerKm)) {
      this.ghostPaceSecPerKm = paceSecPerKm;
    }
  }

  update(telemetryState, _dtSec, { manualPaused = false } = {}) {
    if (telemetryState) {
      this._latestTelemetry = telemetryState;
    }
    this.manualPaused = Boolean(manualPaused);
  }

  _track(resource) {
    if (resource && typeof resource.dispose === 'function') {
      this._disposables.push(resource);
    }
    return resource;
  }

  _initScene(stage) {
    const width = Math.max(320, stage.clientWidth || window.innerWidth);
    const height = Math.max(200, stage.clientHeight || window.innerHeight);

    const renderer = new THREE.WebGLRenderer({
      antialias: this.quality === 'medium',
      powerPreference: 'low-power',
    });
    renderer.shadowMap.enabled = false;
    renderer.setPixelRatio(this.quality === 'medium' ? Math.min(window.devicePixelRatio || 1, 1) : 0.85);
    renderer.setSize(width, height, false);
    renderer.domElement.className = 'three-canvas';
    stage.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(62, width / height, 0.2, 240);
    camera.position.set(0, 1.65, 0);
    camera.lookAt(0, 1.45, -40);
    this.camera = camera;

    const ambientLight = new THREE.AmbientLight('#ffffff', 0.85);
    scene.add(ambientLight);
    this.ambientLight = ambientLight;

    const sunLight = new THREE.DirectionalLight('#ffffff', 0.95);
    sunLight.position.set(16, 28, -40);
    scene.add(sunLight);
    this.sunLight = sunLight;

    const sunGeo = this._track(new THREE.CircleGeometry(22, 28));
    const sunMat = this._track(new THREE.MeshBasicMaterial({ color: '#fff2cc', fog: false }));
    const sunMesh = new THREE.Mesh(sunGeo, sunMat);
    sunMesh.position.set(0, 24, -198);
    scene.add(sunMesh);
    this.sunMesh = sunMesh;

    const worldGroup = new THREE.Group();
    scene.add(worldGroup);
    this.worldGroup = worldGroup;

    // Road ribbon (6.4m wide, 240m long from z=-222 to +18)
    const roadGeo = this._track(new THREE.PlaneGeometry(6.4, SCROLL_SPAN_M, 1, 1));
    roadGeo.rotateX(-Math.PI / 2);
    const roadMat = this._track(new THREE.MeshLambertMaterial({ color: '#ffffff' }));
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.position.set(0, 0, SCROLL_NEAR_Z - SCROLL_SPAN_M / 2);
    worldGroup.add(roadMesh);
    this.roadMesh = roadMesh;

    // Sculpted low-poly terrain corridor
    const terrainGeo = this._track(new THREE.PlaneGeometry(180, SCROLL_SPAN_M, 26, 18));
    terrainGeo.rotateX(-Math.PI / 2);
    const posAttr = terrainGeo.attributes.position;
    const colors = new Float32Array(posAttr.count * 3);
    terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const terrainMat = this._track(
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    );
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.position.set(0, -0.06, SCROLL_NEAR_Z - SCROLL_SPAN_M / 2);
    worldGroup.add(terrainMesh);
    this.terrainGeo = terrainGeo;
    this.terrainMesh = terrainMesh;

    // Pooled instanced scenery (trees/pylons + boulders/crystals)
    const trunkGeo = this._track(new THREE.CylinderGeometry(0.16, 0.24, 2.2, 5));
    const trunkMat = this._track(new THREE.MeshLambertMaterial({ color: '#ffffff' }));
    this.trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, MAX_SCENERY);

    const canopyGeo = this._track(new THREE.ConeGeometry(1.15, 3.2, 5));
    const canopyMat = this._track(new THREE.MeshLambertMaterial({ color: '#ffffff' }));
    this.canopyMesh = new THREE.InstancedMesh(canopyGeo, canopyMat, MAX_SCENERY);

    const propGeo = this._track(new THREE.DodecahedronGeometry(0.58, 0));
    const propMat = this._track(new THREE.MeshLambertMaterial({ color: '#ffffff' }));
    this.propMesh = new THREE.InstancedMesh(propGeo, propMat, MAX_SCENERY);

    const activeCount = this.quality === 'medium' ? MAX_SCENERY : 100;
    this.trunkMesh.count = activeCount;
    this.canopyMesh.count = activeCount;
    this.propMesh.count = activeCount;

    worldGroup.add(this.trunkMesh);
    worldGroup.add(this.canopyMesh);
    worldGroup.add(this.propMesh);

    this._scenerySlots = [];
    for (let i = 0; i < MAX_SCENERY; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      const distX = 5.6 + seededRand(i * 3 + 1) * 32;
      const z = SCROLL_NEAR_Z - (i / MAX_SCENERY) * SCROLL_SPAN_M - seededRand(i * 3 + 2) * 2.5;
      const scale = 0.75 + seededRand(i * 3 + 3) * 0.95;
      const propSide = i % 2 === 0 ? 1 : -1;
      const propX = propSide * (4.8 + seededRand(i * 5 + 4) * 14);
      this._scenerySlots.push({
        side,
        x: side * distX,
        z,
        scale,
        altShade: seededRand(i * 7 + 5) > 0.45,
        propX,
        propZ: z - 1.2,
        propScale: 0.5 + seededRand(i * 9 + 6) * 0.8,
      });
    }

    // 500m Milestone Arch
    this._buildArch();
    // Ghost Pacer Runner
    this._buildGhostPacer();

    this._applyTheme();

    this._resizeObserver = new ResizeObserver(() => this._handleResize());
    this._resizeObserver.observe(stage);
  }

  _buildArch() {
    const archGroup = new THREE.Group();
    const archMat = this._track(new THREE.MeshLambertMaterial({ color: '#38bdf8' }));
    this.archMat = archMat;

    const pillarGeo = this._track(new THREE.BoxGeometry(0.32, 4.2, 0.32));
    const leftPillar = new THREE.Mesh(pillarGeo, archMat);
    leftPillar.position.set(-3.45, 2.1, 0);
    const rightPillar = new THREE.Mesh(pillarGeo, archMat);
    rightPillar.position.set(3.45, 2.1, 0);

    const barGeo = this._track(new THREE.BoxGeometry(7.25, 0.45, 0.32));
    const bar = new THREE.Mesh(barGeo, archMat);
    bar.position.set(0, 4.15, 0);

    this.archSignTex = this._track(createArchSignTexture('0.5 km', '#38bdf8'));
    const signMat = this._track(new THREE.MeshBasicMaterial({ map: this.archSignTex }));
    this.archSignMat = signMat;
    const signGeo = this._track(new THREE.PlaneGeometry(4.0, 0.85));
    const sign = new THREE.Mesh(signGeo, signMat);
    sign.position.set(0, 4.15, 0.2);

    archGroup.add(leftPillar, rightPillar, bar, sign);
    this.worldGroup.add(archGroup);
    this.archGroup = archGroup;
  }

  _buildGhostPacer() {
    const ghostGroup = new THREE.Group();
    const ghostMat = this._track(
      new THREE.MeshLambertMaterial({
        color: '#38bdf8',
        emissive: '#0ea5e9',
        emissiveIntensity: 0.45,
        transparent: true,
        opacity: 0.82,
      }),
    );
    this.ghostMat = ghostMat;

    const head = new THREE.Mesh(this._track(new THREE.SphereGeometry(0.16, 10, 8)), ghostMat);
    head.position.set(0, 1.58, 0);

    const torso = new THREE.Mesh(this._track(new THREE.BoxGeometry(0.34, 0.56, 0.2)), ghostMat);
    torso.position.set(0, 1.12, 0);

    const limbGeo = this._track(new THREE.BoxGeometry(0.12, 0.54, 0.12));
    const armL = new THREE.Mesh(limbGeo, ghostMat);
    armL.position.set(-0.24, 1.12, 0);
    const armR = new THREE.Mesh(limbGeo, ghostMat);
    armR.position.set(0.24, 1.12, 0);
    const legL = new THREE.Mesh(limbGeo, ghostMat);
    legL.position.set(-0.11, 0.55, 0);
    const legR = new THREE.Mesh(limbGeo, ghostMat);
    legR.position.set(0.11, 0.55, 0);

    ghostGroup.add(head, torso, armL, armR, legL, legR);
    ghostGroup.position.set(1.15, 0, -10);
    this.worldGroup.add(ghostGroup);
    this.ghostGroup = ghostGroup;
    this.ghostParts = { armL, armR, legL, legR };
  }

  _applyTheme() {
    const theme = WORLD_THEMES[this.themeKey] || WORLD_THEMES.forest;

    if (this.skyTex) this.skyTex.dispose();
    this.skyTex = this._track(createSkyTexture(theme));
    this.scene.background = this.skyTex;
    this.scene.fog = new THREE.Fog(theme.fogColor, 48, 205);

    this.ambientLight.color.set(theme.ambientColor);
    this.sunLight.color.set(theme.sunColor);
    this.sunMesh.material.color.set(theme.sunDiscColor);

    if (this.roadTex) this.roadTex.dispose();
    this.roadTex = this._track(createRoadTexture(theme));
    this.roadMesh.material.map = this.roadTex;
    this.roadMesh.material.needsUpdate = true;

    this._rebuildTerrainForTheme(theme);

    this.archMat.color.set(theme.archColor);
    this._refreshArchTexture(this._nextArchM, theme.archColor);

    this.ghostMat.color.set(theme.ghostColor);
    this.ghostMat.emissive.set(theme.ghostColor);

    // Recolor instanced scenery
    const trunkCol = new THREE.Color(theme.trunkColor);
    const canopyCol = new THREE.Color(theme.canopyColor);
    const canopyAltCol = new THREE.Color(theme.canopyAltColor);
    const propCol = new THREE.Color(theme.propColor);

    for (let i = 0; i < MAX_SCENERY; i += 1) {
      this.trunkMesh.setColorAt(i, trunkCol);
      this.canopyMesh.setColorAt(i, this._scenerySlots[i].altShade ? canopyAltCol : canopyCol);
      this.propMesh.setColorAt(i, propCol);
    }
    if (this.trunkMesh.instanceColor) this.trunkMesh.instanceColor.needsUpdate = true;
    if (this.canopyMesh.instanceColor) this.canopyMesh.instanceColor.needsUpdate = true;
    if (this.propMesh.instanceColor) this.propMesh.instanceColor.needsUpdate = true;
  }

  _rebuildTerrainForTheme(theme) {
    const pos = this.terrainGeo.attributes.position;
    const col = this.terrainGeo.attributes.color;
    const primary = new THREE.Color(theme.terrainPrimary);
    const secondary = new THREE.Color(theme.terrainSecondary);
    const tmp = new THREE.Color();
    const isCoastal = theme.key === 'coastal';

    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const absX = Math.abs(x);

      let y = 0;
      if (absX > 4.6) {
        if (isCoastal && x > 4.6) {
          y = -0.18;
          tmp.copy(secondary);
        } else {
          const edge = (absX - 4.6) / 14;
          const wave = Math.sin(x * 0.17 + z * 0.08) * 1.4 + Math.cos(z * 0.11) * 0.9;
          y = Math.min(8.5, Math.max(0.05, edge * 1.6 + wave * Math.min(1, edge)));
          tmp.copy(primary).lerp(secondary, Math.min(0.65, edge * 0.15));
        }
      } else {
        tmp.copy(primary);
      }
      pos.setY(i, y);
      col.setXYZ(i, tmp.r, tmp.g, tmp.b);
    }

    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.terrainGeo.computeVertexNormals();
  }

  _refreshArchTexture(archDistM, accentColor) {
    if (this.archSignTex) this.archSignTex.dispose();
    const kmLabel = `${(archDistM / 1000).toFixed(1)} km`;
    this.archSignTex = this._track(createArchSignTexture(kmLabel, accentColor));
    this.archSignMat.map = this.archSignTex;
    this.archSignMat.needsUpdate = true;
  }

  _renderFrame(dt, nowMs) {
    if (!this.renderer || !this.scene || !this.camera) {
      return;
    }

    const t = this._latestTelemetry;
    const speedKph = this.manualPaused ? 0 : (t.smoothedSpeedKph ?? t.speedKph ?? 0);
    const speedMps = speedKph / 3.6;
    const inclinePct = t.inclinePct ?? 0;

    // Smooth incline road tilt (+X rotation raises -Z horizon up)
    const targetPitch = computeInclinePitchRad(inclinePct);
    this._pitchRad += (targetPitch - this._pitchRad) * Math.min(1, dt * 4.5);
    this.worldGroup.rotation.x = this._pitchRad;
    this.sunMesh.position.y = 24 + Math.sin(this._pitchRad) * 65;

    // Scroll road surface towards runner
    const deltaZ = speedMps * dt;
    if (this.roadTex && deltaZ > 0) {
      this.roadTex.offset.y = (this.roadTex.offset.y + deltaZ / ROAD_TILE_METERS) % 1;
    }

    // Update instanced scenery chunks
    const activeCount = this.quality === 'medium' ? MAX_SCENERY : 100;
    const isCoastal = this.themeKey === 'coastal';
    const dummy = this._dummy;

    for (let i = 0; i < activeCount; i += 1) {
      const slot = this._scenerySlots[i];
      slot.z = wrapScrollZ(slot.z, deltaZ, SCROLL_SPAN_M, SCROLL_NEAR_Z);
      slot.propZ = wrapScrollZ(slot.propZ, deltaZ, SCROLL_SPAN_M, SCROLL_NEAR_Z);

      // Keep ocean clear on right side in coastal theme
      const effectiveX = isCoastal && slot.x > 4.6 ? -slot.x : slot.x;
      const baseH = 1.1 * slot.scale;

      dummy.position.set(effectiveX, baseH, slot.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(slot.scale, slot.scale, slot.scale);
      dummy.updateMatrix();
      this.trunkMesh.setMatrixAt(i, dummy.matrix);

      dummy.position.set(effectiveX, baseH * 2 + 1.1 * slot.scale, slot.z);
      dummy.scale.set(slot.scale, slot.scale, slot.scale);
      dummy.updateMatrix();
      this.canopyMesh.setMatrixAt(i, dummy.matrix);

      const propEffectiveX = isCoastal && slot.propX > 4.6 ? -slot.propX : slot.propX;
      dummy.position.set(propEffectiveX, 0.35 * slot.propScale, slot.propZ);
      dummy.rotation.set(0.2, i * 0.7, 0.1);
      dummy.scale.set(slot.propScale, slot.propScale, slot.propScale);
      dummy.updateMatrix();
      this.propMesh.setMatrixAt(i, dummy.matrix);
    }
    this.trunkMesh.instanceMatrix.needsUpdate = true;
    this.canopyMesh.instanceMatrix.needsUpdate = true;
    this.propMesh.instanceMatrix.needsUpdate = true;

    // Update 500m milestone arch
    const runnerDistanceM = t.distanceM ?? 0;
    const nextArch = computeNextArchDistanceM(runnerDistanceM, 500);
    if (nextArch !== this._nextArchM) {
      this._nextArchM = nextArch;
      const theme = WORLD_THEMES[this.themeKey] || WORLD_THEMES.forest;
      this._refreshArchTexture(nextArch, theme.archColor);
    }
    const archZ = -(this._nextArchM - runnerDistanceM);
    this.archGroup.visible = archZ >= -210 && archZ <= 15;
    this.archGroup.position.set(0, 0, archZ);

    // Update Ghost Pacer
    const ghost = updateGhostPacer({
      runnerDistanceM,
      targetPaceSecPerKm: this.ghostPaceSecPerKm,
      elapsedSec: t.elapsedSec ?? 0,
      enabled: this.ghostEnabled,
    });
    this.ghostGroup.visible = ghost.visibleInRange;
    if (ghost.visibleInRange) {
      this.ghostGroup.position.set(1.15, 0, ghost.zOffset);
      if (!this.manualPaused && t.recordingState === 'running') {
        this._ghostPhase += dt * 9.2;
      }
      const swing = Math.sin(this._ghostPhase) * 0.55;
      this.ghostParts.legL.rotation.x = swing;
      this.ghostParts.legR.rotation.x = -swing;
      this.ghostParts.armL.rotation.x = -swing * 0.8;
      this.ghostParts.armR.rotation.x = swing * 0.8;
    }

    if (nowMs - this._lastGhostEmitMs >= 250) {
      this._lastGhostEmitMs = nowMs;
      this.dispatchEvent(
        new CustomEvent('ghostupdate', {
          detail: {
            enabled: ghost.enabled,
            gapM: ghost.gapM,
            gapSec: ghost.gapSec,
            paceSecPerKm: this.ghostPaceSecPerKm,
          },
        }),
      );
    }

    // Subtle cadence-synced camera bob
    const cadenceHz = Math.max(1.2, (t.cadenceSpm || 165) / 120);
    if (speedKph >= 0.5 && !this.manualPaused) {
      this._stridePhase += dt * cadenceHz * Math.PI * 2;
    }
    const bob = computeStrideBobOffset(this._stridePhase, speedKph, this.cameraBob);
    this.camera.position.set(bob.x, 1.65 + bob.y, 0);

    this.renderer.render(this.scene, this.camera);
  }

  _handleResize() {
    if (!this.renderer || !this.camera || !this.container) {
      return;
    }
    const width = Math.max(320, this.container.clientWidth || window.innerWidth);
    const height = Math.max(200, this.container.clientHeight || window.innerHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }
}
