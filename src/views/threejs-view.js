/**
 * Bright, multi-tier Three.js 3D Runner View (Phases 2A + 2B):
 * - Endless procedural corridor (Phase 2A) OR true 3D curving/hilly .gpx courses (Phase 2B)
 * - Low (battery/max FPS), Medium (Lenovo Duet default), High (Gaming PC Ultra w/ shadows & particles)
 * - Hemisphere + front-3/4 sunlight + ACESFilmicToneMapping for crisp, sunlit scenes
 * - 3 live-switchable themes (Forest Trail, Coastal Sunset, Synthwave Grid)
 * - Dynamic incline pitch, 500 m milestone arches, toggleable stride bob, and Ghost Pacer
 */

import * as THREE from '../../vendor/three.module.min.js';
import { buildRoadRibbonGeometry } from '../world/road-terrain-mesh.js';
import { sampleRouteAtDistance } from '../world/gpx-route.js';
import {
  QUALITY_PRESETS,
  WORLD_THEMES,
  computeInclinePitchRad,
  computeNextArchDistanceM,
  computeStrideBobOffset,
  getQualityPreset,
  updateGhostPacer,
  wrapScrollZ,
} from './threejs-math.js';

const SCROLL_NEAR_Z = 20;
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
  grad.addColorStop(0.48, theme.skyMid);
  grad.addColorStop(0.84, theme.skyHorizon);
  grad.addColorStop(1, theme.fogColor);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createSunDiscTexture(theme) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);

  ctx.save();
  ctx.beginPath();
  ctx.arc(128, 128, 120, 0, Math.PI * 2);
  ctx.clip();

  const grad = ctx.createLinearGradient(0, 8, 0, 248);
  if (theme.key === 'synthwave') {
    grad.addColorStop(0, '#fde047');
    grad.addColorStop(0.5, theme.sunDiscColor);
    grad.addColorStop(1, '#db2777');
  } else {
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.65, theme.sunDiscColor);
    grad.addColorStop(1, theme.sunHaloColor);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  if (theme.key === 'synthwave') {
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 6; i += 1) {
      const y = 136 + i * 20;
      const h = 3 + i * 1.6;
      ctx.fillRect(0, y, 256, h);
    }
  }
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createSunHaloTexture(theme) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(128, 128, 18, 128, 128, 128);
  grad.addColorStop(0, theme.sunHaloColor);
  grad.addColorStop(0.4, `${theme.sunHaloColor}66`);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createRoadTexture(theme, repeatY = 24) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = theme.roadBase;
  ctx.fillRect(0, 0, 512, 512);

  if (theme.key === 'coastal') {
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let y = 0; y < 512; y += 32) {
      ctx.fillRect(0, y, 512, 3);
    }
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    for (let i = 0; i < 240; i += 1) {
      const rx = seededRand(i + 1) * 512;
      const ry = seededRand(i + 241) * 512;
      ctx.fillRect(rx, ry, 4, 6);
    }
  }

  ctx.fillStyle = theme.roadShoulder;
  ctx.fillRect(18, 0, 14, 512);
  ctx.fillRect(480, 0, 14, 512);

  ctx.fillStyle = theme.roadStripe;
  ctx.fillRect(248, 34, 16, 190);
  ctx.fillRect(248, 290, 16, 190);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createSynthGridTexture(theme, spanM) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = theme.terrainPrimary;
  ctx.fillRect(0, 0, 256, 256);

  ctx.strokeStyle = theme.terrainSecondary;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 252, 252);
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(128, 0);
  ctx.lineTo(128, 256);
  ctx.moveTo(0, 128);
  ctx.lineTo(256, 128);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(22, spanM / 8);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createOceanTexture(spanM) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0891b2';
  ctx.fillRect(0, 0, 256, 256);

  ctx.fillStyle = 'rgba(224, 242, 254, 0.28)';
  for (let i = 0; i < 28; i += 1) {
    const x = seededRand(i * 11 + 3) * 210;
    const y = seededRand(i * 11 + 7) * 246;
    ctx.fillRect(x, y, 36, 4);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, spanM / 14);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createParticleTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

function createArchSignTexture(labelText, accentColor) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0f172a';
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
    quality = 'medium',
    cameraBob = true,
    ghostEnabled = true,
    ghostPaceSecPerKm = 330,
    gpxRoute = null,
  } = {}) {
    super();
    this.themeKey = WORLD_THEMES[theme] ? theme : 'forest';
    this.quality = QUALITY_PRESETS[quality] ? quality : 'medium';
    this.cameraBob = Boolean(cameraBob);
    this.ghostEnabled = Boolean(ghostEnabled);
    this.ghostPaceSecPerKm = ghostPaceSecPerKm;
    this.gpxRoute = gpxRoute;
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
    this._fpsEma = 60;
    this._frameMsEma = 16.6;
    this._lastPerfEmitMs = 0;
    this._nextArchM = 500;
    this._spanM = 285;
    this._disposables = [];
    this._gpxDisposables = [];

    this.forestLandmarks = null;
    this.coastalLandmarks = null;
    this.synthLandmarks = null;

    // Three.js handles
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.worldGroup = null;
    this.corridorGroup = null;
    this.gpxGroup = null;

    this.hemiLight = null;
    this.sunLight = null;
    this.rimLight = null;
    this.sunDiscMesh = null;
    this.sunHaloMesh = null;
    this.sunDiscTex = null;
    this.sunHaloTex = null;
    this.skyTex = null;

    this.roadMesh = null;
    this.roadTex = null;
    this.terrainGeo = null;
    this.terrainMesh = null;
    this.synthGridTex = null;
    this.oceanMesh = null;
    this.oceanTex = null;

    this.trunkMesh = null;
    this.canopyLowerMesh = null;
    this.canopyUpperMesh = null;
    this.propMesh = null;
    this.grassMesh = null;
    this.cloudMesh = null;
    this.mountainGroup = null;
    this.mountainMat = null;
    this.mountainCapMat = null;
    this.particlePoints = null;
    this.particlePositions = null;

    this.archGroup = null;
    this.archSignMat = null;
    this.archSignTex = null;
    this.archMat = null;
    this.ghostGroup = null;
    this.ghostParts = null;
    this.ghostMat = null;
    this.ghostRingMat = null;

    this.gpxRoadMesh = null;
    this.gpxRoadTex = null;
    this.gpxSkirtMesh = null;
    this.gpxTrunkMesh = null;
    this.gpxCanopyLowerMesh = null;
    this.gpxCanopyUpperMesh = null;
    this.gpxPropMesh = null;

    this._scenerySlots = [];
    this._grassSlots = [];
    this._cloudSlots = [];
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
    this._disposeGpxScene();
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
    this.corridorGroup = null;
    this.oceanMesh = null;
    this.grassMesh = null;
    this.cloudMesh = null;
    this.mountainGroup = null;
    this.particlePoints = null;
    this.particlePositions = null;
    this._scenerySlots = [];
    this._grassSlots = [];
    this._cloudSlots = [];
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
      if (this.gpxRoute) {
        this._rebuildGpxScene();
      }
    }
  }

  setGpxRoute(routeOrNull) {
    this.gpxRoute = routeOrNull || null;
    if (this.scene) {
      this._rebuildGpxScene();
    }
  }

  async setQuality(quality) {
    const normalized = QUALITY_PRESETS[quality] ? quality : 'medium';
    if (normalized === this.quality) {
      return;
    }
    this.quality = normalized;
    if (this._mounted && this.container) {
      const targetContainer = this.container;
      const paused = this.manualPaused;
      await this.unmount();
      await this.mount(targetContainer, { manualPaused: paused });
    }
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

  _trackGpx(resource) {
    if (resource && typeof resource.dispose === 'function') {
      this._gpxDisposables.push(resource);
    }
    return resource;
  }

  _makeLitMaterial(preset, params = {}, trackList = 'main') {
    const mat = preset.useStandardMaterials
      ? new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0.06, ...params })
      : new THREE.MeshLambertMaterial(params);
    return trackList === 'gpx' ? this._trackGpx(mat) : this._track(mat);
  }

  _initScene(stage) {
    const preset = getQualityPreset(this.quality);
    const spanM = Math.max(240, preset.farClip);
    this._spanM = spanM;

    const width = Math.max(320, stage.clientWidth || window.innerWidth);
    const height = Math.max(200, stage.clientHeight || window.innerHeight);

    const renderer = new THREE.WebGLRenderer({
      antialias: preset.antialias,
      powerPreference: preset.key === 'high' ? 'high-performance' : 'default',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    renderer.shadowMap.enabled = preset.shadows;
    if (preset.shadows) {
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.maxDpr));
    renderer.setSize(width, height, false);
    renderer.domElement.className = 'three-canvas';
    stage.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(62, width / height, 0.2, spanM + 60);
    camera.position.set(0, 1.65, 0);
    camera.lookAt(0, 1.45, -45);
    this.camera = camera;

    const hemiLight = new THREE.HemisphereLight('#e0f2fe', '#3f6212', 1.15);
    scene.add(hemiLight);
    this.hemiLight = hemiLight;

    const sunLight = new THREE.DirectionalLight('#fff7ed', 2.2);
    sunLight.position.set(28, 46, 36);
    sunLight.target.position.set(0, 0, -35);
    scene.add(sunLight);
    scene.add(sunLight.target);
    if (preset.shadows) {
      sunLight.castShadow = true;
      sunLight.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
      sunLight.shadow.camera.left = -45;
      sunLight.shadow.camera.right = 45;
      sunLight.shadow.camera.top = 45;
      sunLight.shadow.camera.bottom = -45;
      sunLight.shadow.camera.near = 5;
      sunLight.shadow.camera.far = 180;
      sunLight.shadow.bias = -0.0005;
    }
    this.sunLight = sunLight;

    if (preset.key === 'high') {
      const rimLight = new THREE.DirectionalLight('#bae6fd', 0.55);
      rimLight.position.set(-22, 18, -50);
      scene.add(rimLight);
      this.rimLight = rimLight;
    }

    const sunHaloGeo = this._track(new THREE.PlaneGeometry(92, 92));
    const sunHaloMat = this._track(
      new THREE.MeshBasicMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    const sunHaloMesh = new THREE.Mesh(sunHaloGeo, sunHaloMat);
    sunHaloMesh.position.set(0, 30, -(spanM - 15));
    scene.add(sunHaloMesh);
    this.sunHaloMesh = sunHaloMesh;

    const sunDiscGeo = this._track(new THREE.PlaneGeometry(46, 46));
    const sunDiscMat = this._track(
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false }),
    );
    const sunDiscMesh = new THREE.Mesh(sunDiscGeo, sunDiscMat);
    sunDiscMesh.position.set(0, 30, -(spanM - 16));
    scene.add(sunDiscMesh);
    this.sunDiscMesh = sunDiscMesh;

    const worldGroup = new THREE.Group();
    scene.add(worldGroup);
    this.worldGroup = worldGroup;

    const corridorGroup = new THREE.Group();
    worldGroup.add(corridorGroup);
    this.corridorGroup = corridorGroup;

    // Endless road ribbon
    const roadGeo = this._track(new THREE.PlaneGeometry(6.6, spanM, 1, 1));
    roadGeo.rotateX(-Math.PI / 2);
    const roadMat = this._makeLitMaterial(preset, { color: '#ffffff', roughness: 0.86 });
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.position.set(0, 0, SCROLL_NEAR_Z - spanM / 2);
    roadMesh.receiveShadow = preset.shadows;
    corridorGroup.add(roadMesh);
    this.roadMesh = roadMesh;

    // Endless terrain corridor
    const terrainGeo = this._track(
      new THREE.PlaneGeometry(210, spanM, preset.terrainSegX, preset.terrainSegZ),
    );
    terrainGeo.rotateX(-Math.PI / 2);
    const posAttr = terrainGeo.attributes.position;
    const colors = new Float32Array(posAttr.count * 3);
    terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const terrainMat = this._makeLitMaterial(preset, {
      vertexColors: true,
      flatShading: true,
      roughness: 0.92,
    });
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.position.set(0, -0.06, SCROLL_NEAR_Z - spanM / 2);
    terrainMesh.receiveShadow = preset.shadows;
    corridorGroup.add(terrainMesh);
    this.terrainGeo = terrainGeo;
    this.terrainMesh = terrainMesh;

    // Coastal ocean
    const oceanGeo = this._track(new THREE.PlaneGeometry(110, spanM, 1, 1));
    oceanGeo.rotateX(-Math.PI / 2);
    const oceanMat = this._makeLitMaterial(preset, {
      color: '#ffffff',
      roughness: 0.25,
      metalness: 0.15,
    });
    const oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
    oceanMesh.position.set(59.6, -0.14, SCROLL_NEAR_Z - spanM / 2);
    oceanMesh.receiveShadow = preset.shadows;
    corridorGroup.add(oceanMesh);
    this.oceanMesh = oceanMesh;

    // Endless instanced scenery
    const count = preset.sceneryCount;
    const trunkGeo = this._track(new THREE.CylinderGeometry(0.16, 0.25, 2.2, 6));
    const trunkMat = this._makeLitMaterial(preset, { color: '#ffffff' });
    this.trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, count);

    const lowerGeo = this._track(new THREE.ConeGeometry(1.28, 2.5, 6));
    const lowerMat = this._makeLitMaterial(preset, { color: '#ffffff' });
    this.canopyLowerMesh = new THREE.InstancedMesh(lowerGeo, lowerMat, count);

    const upperGeo = this._track(new THREE.ConeGeometry(0.92, 2.4, 6));
    const upperMat = this._makeLitMaterial(preset, { color: '#ffffff' });
    this.canopyUpperMesh = new THREE.InstancedMesh(upperGeo, upperMat, count);

    const propGeo = this._track(new THREE.DodecahedronGeometry(0.56, 0));
    const propMat = this._makeLitMaterial(preset, { color: '#ffffff' });
    this.propMesh = new THREE.InstancedMesh(propGeo, propMat, count);

    if (preset.shadows) {
      this.trunkMesh.castShadow = true;
      this.canopyLowerMesh.castShadow = true;
      this.canopyUpperMesh.castShadow = true;
      this.propMesh.castShadow = true;
    }

    corridorGroup.add(this.trunkMesh, this.canopyLowerMesh, this.canopyUpperMesh, this.propMesh);

    this._scenerySlots = [];
    for (let i = 0; i < count; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      const distX = 5.4 + seededRand(i * 3 + 1) * 40;
      const z = SCROLL_NEAR_Z - (i / count) * spanM - seededRand(i * 3 + 2) * 2.5;
      const scale = 0.78 + seededRand(i * 3 + 3) * 0.95;
      const propSide = i % 2 === 0 ? 1 : -1;
      const propX = propSide * (4.6 + seededRand(i * 5 + 4) * 16);
      this._scenerySlots.push({
        side,
        x: side * distX,
        z,
        scale,
        altShade: seededRand(i * 7 + 5) > 0.45,
        propX,
        propZ: z - 1.4,
        propScale: 0.48 + seededRand(i * 9 + 6) * 0.85,
      });
    }

    if (preset.grassCount > 0) {
      const grassGeo = this._track(new THREE.ConeGeometry(0.24, 0.75, 4));
      const grassMat = this._makeLitMaterial(preset, { color: '#ffffff' });
      this.grassMesh = new THREE.InstancedMesh(grassGeo, grassMat, preset.grassCount);
      corridorGroup.add(this.grassMesh);

      this._grassSlots = [];
      for (let i = 0; i < preset.grassCount; i += 1) {
        const side = i % 2 === 0 ? -1 : 1;
        this._grassSlots.push({
          x: side * (3.7 + seededRand(i * 13 + 2) * 4.5),
          z: SCROLL_NEAR_Z - (i / preset.grassCount) * spanM,
          scale: 0.65 + seededRand(i * 13 + 7) * 0.85,
          tilt: (seededRand(i * 13 + 11) - 0.5) * 0.25,
        });
      }
    }

    if (preset.key !== 'low') {
      this._buildMountains(preset, spanM);
      this._buildClouds(preset, spanM);
    }

    if (preset.particleCount > 0) {
      this._buildParticles(preset.particleCount, spanM);
    }

    this._buildArch(preset);
    this._buildLandmarks(preset, spanM);
    this._buildGhostPacer(preset);
    this._applyTheme();

    if (this.gpxRoute) {
      this._rebuildGpxScene();
    }

    this._resizeObserver = new ResizeObserver(() => this._handleResize());
    this._resizeObserver.observe(stage);
  }

  _disposeGpxScene() {
    if (this.gpxGroup && this.scene) {
      this.scene.remove(this.gpxGroup);
    }
    for (const item of this._gpxDisposables) {
      try {
        item.dispose();
      } catch {
        // Ignore disposal error.
      }
    }
    this._gpxDisposables = [];
    this.gpxGroup = null;
    this.gpxRoadMesh = null;
    this.gpxRoadTex = null;
    this.gpxSkirtMesh = null;
    this.gpxTrunkMesh = null;
    this.gpxCanopyLowerMesh = null;
    this.gpxCanopyUpperMesh = null;
    this.gpxPropMesh = null;
  }

  _rebuildGpxScene() {
    this._disposeGpxScene();
    if (!this.gpxRoute || !this.scene) {
      if (this.corridorGroup) {
        this.corridorGroup.visible = true;
      }
      return;
    }

    this.corridorGroup.visible = false;
    this.worldGroup.rotation.x = 0;

    const route = this.gpxRoute;
    const preset = getQualityPreset(this.quality);
    const theme = WORLD_THEMES[this.themeKey] || WORLD_THEMES.forest;

    const gpxGroup = new THREE.Group();
    this.scene.add(gpxGroup);
    this.gpxGroup = gpxGroup;

    // 1. Real 3D curving road ribbon (yOffset 0.08 keeps clear of roadbed skirt)
    const ribbon = buildRoadRibbonGeometry(route.samples, {
      widthM: 5.8,
      shoulderM: 1.0,
      yOffset: 0.08,
    });
    const roadGeo = this._trackGpx(new THREE.BufferGeometry());
    roadGeo.setAttribute('position', new THREE.BufferAttribute(ribbon.positions, 3));
    roadGeo.setAttribute('normal', new THREE.BufferAttribute(ribbon.normals, 3));
    roadGeo.setAttribute('uv', new THREE.BufferAttribute(ribbon.uvs, 2));
    roadGeo.setIndex(new THREE.BufferAttribute(ribbon.indices, 1));
    roadGeo.computeVertexNormals();

    this.gpxRoadTex = this._trackGpx(createRoadTexture(theme, 0.58));
    if (this.renderer) {
      this.gpxRoadTex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    }
    const roadMat = this._makeLitMaterial(
      preset,
      { color: '#ffffff', map: this.gpxRoadTex, roughness: 0.86 },
      'gpx',
    );
    const gpxRoadMesh = new THREE.Mesh(roadGeo, roadMat);
    gpxRoadMesh.receiveShadow = preset.shadows;
    gpxGroup.add(gpxRoadMesh);
    this.gpxRoadMesh = gpxRoadMesh;

    // 2. Sculpted 3D roadside terrain skirt
    this._buildGpxTerrainSkirt(route, theme, preset, gpxGroup);

    // 3. Route-aligned instanced trees/pylons/props
    this._buildGpxScenery(route, theme, preset, gpxGroup);

    // 4. Route-aligned 500 m milestone arches
    const archInterval = 500;
    const archCount = Math.min(16, Math.floor(route.totalDistanceM / archInterval));
    for (let k = 1; k <= archCount; k += 1) {
      const distM = k * archInterval;
      const smp = sampleRouteAtDistance(route, distM, { loop: false });
      const arch = this._createStaticArch(`${(distM / 1000).toFixed(1)} km`, theme.archColor, preset);
      arch.position.set(smp.x, smp.y, smp.z);
      arch.lookAt(smp.x + smp.tangent[0], smp.y + smp.tangent[1], smp.z + smp.tangent[2]);
      gpxGroup.add(arch);
    }
  }

  _buildGpxTerrainSkirt(route, theme, preset, parentGroup) {
    const stride = Math.max(1, Math.floor(route.samples.length / 420));
    const samples = [];
    for (let i = 0; i < route.samples.length; i += stride) {
      samples.push(route.samples[i]);
    }
    if (samples[samples.length - 1] !== route.samples[route.samples.length - 1]) {
      samples.push(route.samples[route.samples.length - 1]);
    }

    const cols = [-74, -36, -15, -4.3, 4.3, 15, 36, 74];
    const colCount = cols.length;
    const vertCount = samples.length * colCount;
    const positions = new Float32Array(vertCount * 3);
    const colors = new Float32Array(vertCount * 3);

    const primary = new THREE.Color(theme.terrainPrimary);
    const secondary = new THREE.Color(theme.terrainSecondary);
    const tmp = new THREE.Color();
    const isCoastal = theme.key === 'coastal';

    for (let i = 0; i < samples.length; i += 1) {
      const smp = samples[i];
      const rx = smp.right[0];
      const rz = smp.right[2];

      for (let c = 0; c < colCount; c += 1) {
        const lat = cols[c];
        const absLat = Math.abs(lat);
        const idx = (i * colCount + c) * 3;

        let y = smp.y - 0.08;
        if (absLat > 4.4) {
          if (isCoastal && lat > 4.4) {
            y = smp.y - 0.45;
            tmp.copy(secondary);
          } else {
            const edge = (absLat - 4.4) / 14;
            const wave = Math.sin(smp.s * 0.04 + lat * 0.14) * 2.1 + Math.cos(lat * 0.11) * 1.1;
            y = smp.y + Math.max(0.05, edge * 1.4 + wave * Math.min(1, edge));
            tmp.copy(primary).lerp(secondary, Math.min(0.65, edge * 0.18));
          }
        } else {
          tmp.copy(primary);
        }

        positions[idx] = smp.x + rx * lat;
        positions[idx + 1] = y;
        positions[idx + 2] = smp.z + rz * lat;
        colors[idx] = tmp.r;
        colors[idx + 1] = tmp.g;
        colors[idx + 2] = tmp.b;
      }
    }

    const segCount = samples.length - 1;
    const quadsPerSeg = colCount - 1;
    const indices = new Uint32Array(segCount * quadsPerSeg * 6);
    let ptr = 0;
    for (let i = 0; i < segCount; i += 1) {
      const r0 = i * colCount;
      const r1 = (i + 1) * colCount;
      for (let c = 0; c < quadsPerSeg; c += 1) {
        const a = r0 + c;
        const b = r0 + c + 1;
        const d = r1 + c;
        const e = r1 + c + 1;
        indices[ptr] = a;
        indices[ptr + 1] = b;
        indices[ptr + 2] = d;
        indices[ptr + 3] = b;
        indices[ptr + 4] = e;
        indices[ptr + 5] = d;
        ptr += 6;
      }
    }

    const geo = this._trackGpx(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();

    const mat = this._makeLitMaterial(
      preset,
      { vertexColors: true, flatShading: true, roughness: 0.92 },
      'gpx',
    );
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = preset.shadows;
    parentGroup.add(mesh);
    this.gpxSkirtMesh = mesh;
  }

  _buildGpxScenery(route, theme, preset, parentGroup) {
    const count = Math.min(480, Math.max(120, Math.round((route.totalDistanceM / 5000) * preset.sceneryCount * 1.4)));
    const trunkGeo = this._trackGpx(new THREE.CylinderGeometry(0.16, 0.25, 2.2, 6));
    const trunkMat = this._makeLitMaterial(preset, { color: '#ffffff' }, 'gpx');
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, count);

    const lowerGeo = this._trackGpx(new THREE.ConeGeometry(1.28, 2.5, 6));
    const lowerMat = this._makeLitMaterial(preset, { color: '#ffffff' }, 'gpx');
    const lowerMesh = new THREE.InstancedMesh(lowerGeo, lowerMat, count);

    const upperGeo = this._trackGpx(new THREE.ConeGeometry(0.92, 2.4, 6));
    const upperMat = this._makeLitMaterial(preset, { color: '#ffffff' }, 'gpx');
    const upperMesh = new THREE.InstancedMesh(upperGeo, upperMat, count);

    const propGeo = this._trackGpx(new THREE.DodecahedronGeometry(0.56, 0));
    const propMat = this._makeLitMaterial(preset, { color: '#ffffff' }, 'gpx');
    const propMesh = new THREE.InstancedMesh(propGeo, propMat, count);

    if (preset.shadows) {
      trunkMesh.castShadow = true;
      lowerMesh.castShadow = true;
      upperMesh.castShadow = true;
      propMesh.castShadow = true;
    }

    const trunkCol = new THREE.Color(theme.trunkColor);
    const canopyCol = new THREE.Color(theme.canopyColor);
    const canopyAltCol = new THREE.Color(theme.canopyAltColor);
    const propCol = new THREE.Color(theme.propColor);
    const isCoastal = theme.key === 'coastal';
    const dummy = this._dummy;

    for (let i = 0; i < count; i += 1) {
      const s = (i / count) * route.totalDistanceM;
      const smp = sampleRouteAtDistance(route, s, { loop: false });
      const rawSide = i % 2 === 0 ? -1 : 1;
      const side = isCoastal && rawSide > 0 ? -1 : rawSide;
      const lat = side * (6.2 + seededRand(i * 3 + 1) * 24);
      const scale = 0.78 + seededRand(i * 3 + 3) * 0.95;

      const x = smp.x + smp.right[0] * lat;
      const y = smp.y;
      const z = smp.z + smp.right[2] * lat;

      dummy.position.set(x, y + 1.1 * scale, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      trunkMesh.setMatrixAt(i, dummy.matrix);
      trunkMesh.setColorAt(i, trunkCol);

      const cCol = seededRand(i * 7 + 5) > 0.45 ? canopyAltCol : canopyCol;
      dummy.position.set(x, y + 2.55 * scale, z);
      dummy.updateMatrix();
      lowerMesh.setMatrixAt(i, dummy.matrix);
      lowerMesh.setColorAt(i, cCol);

      dummy.position.set(x, y + 3.85 * scale, z);
      dummy.updateMatrix();
      upperMesh.setMatrixAt(i, dummy.matrix);
      upperMesh.setColorAt(i, cCol);

      const pLat = -side * (4.6 + seededRand(i * 5 + 4) * 9);
      const pEffectiveLat = isCoastal && pLat > 4.2 ? -Math.abs(pLat) : pLat;
      const pScale = 0.48 + seededRand(i * 9 + 6) * 0.85;
      dummy.position.set(smp.x + smp.right[0] * pEffectiveLat, y + 0.34 * pScale, smp.z + smp.right[2] * pEffectiveLat);
      dummy.rotation.set(0.2, i * 0.7, 0.1);
      dummy.scale.set(pScale, pScale, pScale);
      dummy.updateMatrix();
      propMesh.setMatrixAt(i, dummy.matrix);
      propMesh.setColorAt(i, propCol);
    }

    trunkMesh.instanceMatrix.needsUpdate = true;
    lowerMesh.instanceMatrix.needsUpdate = true;
    upperMesh.instanceMatrix.needsUpdate = true;
    propMesh.instanceMatrix.needsUpdate = true;
    if (trunkMesh.instanceColor) trunkMesh.instanceColor.needsUpdate = true;
    if (lowerMesh.instanceColor) lowerMesh.instanceColor.needsUpdate = true;
    if (upperMesh.instanceColor) upperMesh.instanceColor.needsUpdate = true;
    if (propMesh.instanceColor) propMesh.instanceColor.needsUpdate = true;

    parentGroup.add(trunkMesh, lowerMesh, upperMesh, propMesh);
    this.gpxTrunkMesh = trunkMesh;
    this.gpxCanopyLowerMesh = lowerMesh;
    this.gpxCanopyUpperMesh = upperMesh;
    this.gpxPropMesh = propMesh;
  }

  _createStaticArch(label, accentColor, preset) {
    const group = new THREE.Group();
    const mat = this._makeLitMaterial(preset, { color: accentColor }, 'gpx');

    const pillarGeo = this._trackGpx(new THREE.BoxGeometry(0.32, 4.2, 0.32));
    const leftPillar = new THREE.Mesh(pillarGeo, mat);
    leftPillar.position.set(-3.3, 2.1, 0);
    const rightPillar = new THREE.Mesh(pillarGeo, mat);
    rightPillar.position.set(3.3, 2.1, 0);

    const barGeo = this._trackGpx(new THREE.BoxGeometry(6.9, 0.45, 0.32));
    const bar = new THREE.Mesh(barGeo, mat);
    bar.position.set(0, 4.15, 0);

    if (preset.shadows) {
      leftPillar.castShadow = true;
      rightPillar.castShadow = true;
      bar.castShadow = true;
    }

    const signTex = this._trackGpx(createArchSignTexture(label, accentColor));
    const signMat = this._trackGpx(new THREE.MeshBasicMaterial({ map: signTex, side: THREE.DoubleSide }));
    const sign = new THREE.Mesh(this._trackGpx(new THREE.PlaneGeometry(3.8, 0.85)), signMat);
    sign.position.set(0, 4.15, 0);

    group.add(leftPillar, rightPillar, bar, sign);
    return group;
  }

  _buildMountains(preset, spanM) {
    const group = new THREE.Group();
    const mountainMat = this._makeLitMaterial(preset, { color: '#64748b', flatShading: true });
    const capMat = this._makeLitMaterial(preset, { color: '#f8fafc', flatShading: true });
    this.mountainMat = mountainMat;
    this.mountainCapMat = capMat;

    const peakCount = 15;
    for (let i = 0; i < peakCount; i += 1) {
      const x = -175 + (i / (peakCount - 1)) * 350 + (seededRand(i + 50) - 0.5) * 14;
      const h = 34 + seededRand(i * 3 + 51) * 34;
      const r = 24 + seededRand(i * 3 + 52) * 18;
      const z = -(spanM - 48) - seededRand(i * 3 + 53) * 26;

      const body = new THREE.Mesh(this._track(new THREE.ConeGeometry(r, h, 5)), mountainMat);
      body.position.set(x, h * 0.45, z);
      group.add(body);

      const cap = new THREE.Mesh(
        this._track(new THREE.ConeGeometry(r * 0.38, h * 0.36, 5)),
        capMat,
      );
      cap.position.set(x, h * 0.78, z);
      group.add(cap);
    }

    this.corridorGroup.add(group);
    this.mountainGroup = group;
  }

  _buildClouds(preset, spanM) {
    const geo = this._track(new THREE.DodecahedronGeometry(3.2, 0));
    const mat = this._track(
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.82 }),
    );
    const mesh = new THREE.InstancedMesh(geo, mat, preset.cloudCount);
    this.scene.add(mesh);
    this.cloudMesh = mesh;

    this._cloudSlots = [];
    for (let i = 0; i < preset.cloudCount; i += 1) {
      this._cloudSlots.push({
        x: (seededRand(i * 17 + 1) - 0.5) * 180,
        y: 28 + seededRand(i * 17 + 2) * 24,
        z: SCROLL_NEAR_Z - (i / preset.cloudCount) * spanM,
        sx: 1.6 + seededRand(i * 17 + 3) * 2.2,
        sy: 0.45 + seededRand(i * 17 + 4) * 0.35,
        sz: 1.1 + seededRand(i * 17 + 5) * 1.4,
        driftSpeed: 0.4 + seededRand(i * 17 + 6) * 0.8,
      });
    }
  }

  _buildParticles(count, spanM) {
    const geo = this._track(new THREE.BufferGeometry());
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (seededRand(i * 23 + 1) - 0.5) * 38;
      positions[i * 3 + 1] = 0.6 + seededRand(i * 23 + 2) * 6.5;
      positions[i * 3 + 2] = SCROLL_NEAR_Z - seededRand(i * 23 + 3) * (spanM * 0.45);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const sprite = this._track(createParticleTexture());
    const mat = this._track(
      new THREE.PointsMaterial({
        size: 0.36,
        map: sprite,
        color: '#fef08a',
        transparent: true,
        opacity: 0.78,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const pts = new THREE.Points(geo, mat);
    this.worldGroup.add(pts);
    this.particlePoints = pts;
    this.particlePositions = positions;
  }

  _buildArch(preset) {
    const archGroup = new THREE.Group();
    const archMat = this._makeLitMaterial(preset, { color: '#0ea5e9' });
    this.archMat = archMat;

    const pillarGeo = this._track(new THREE.BoxGeometry(0.32, 4.2, 0.32));
    const leftPillar = new THREE.Mesh(pillarGeo, archMat);
    leftPillar.position.set(-3.55, 2.1, 0);
    const rightPillar = new THREE.Mesh(pillarGeo, archMat);
    rightPillar.position.set(3.55, 2.1, 0);

    const barGeo = this._track(new THREE.BoxGeometry(7.45, 0.45, 0.32));
    const bar = new THREE.Mesh(barGeo, archMat);
    bar.position.set(0, 4.15, 0);

    if (preset.shadows) {
      leftPillar.castShadow = true;
      rightPillar.castShadow = true;
      bar.castShadow = true;
    }

    this.archSignTex = this._track(createArchSignTexture('0.5 km', '#0ea5e9'));
    const signMat = this._track(new THREE.MeshBasicMaterial({ map: this.archSignTex }));
    this.archSignMat = signMat;
    const signGeo = this._track(new THREE.PlaneGeometry(4.0, 0.85));
    const sign = new THREE.Mesh(signGeo, signMat);
    sign.position.set(0, 4.15, 0.2);

    archGroup.add(leftPillar, rightPillar, bar, sign);
    this.corridorGroup.add(archGroup);
    this.archGroup = archGroup;
  }

  _buildLandmarks(preset, spanM) {
    const dummy = this._dummy;

    // 1. Forest Trail landmarks: wildflower blooms + wooden trail posts
    const forestGroup = new THREE.Group();
    const flowerCount = 48;
    const flowerGeo = this._track(new THREE.DodecahedronGeometry(0.18, 0));
    const flowerMat = this._makeLitMaterial(preset, { color: '#ffffff' });
    const flowerMesh = new THREE.InstancedMesh(flowerGeo, flowerMat, flowerCount);
    const flowerColors = [new THREE.Color('#fde047'), new THREE.Color('#f8fafc'), new THREE.Color('#f472b6')];
    const flowerSlots = [];
    for (let i = 0; i < flowerCount; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      flowerSlots.push({
        x: side * (3.7 + seededRand(i * 19 + 1) * 3.6),
        z: SCROLL_NEAR_Z - (i / flowerCount) * spanM,
        scale: 0.75 + seededRand(i * 19 + 2) * 0.75,
      });
      flowerMesh.setColorAt(i, flowerColors[i % flowerColors.length]);
    }
    if (flowerMesh.instanceColor) flowerMesh.instanceColor.needsUpdate = true;

    const postCount = 36;
    const postGeo = this._track(new THREE.BoxGeometry(0.14, 0.9, 0.14));
    const postMat = this._makeLitMaterial(preset, { color: '#92623a' });
    const postMesh = new THREE.InstancedMesh(postGeo, postMat, postCount);
    if (preset.shadows) postMesh.castShadow = true;
    const postSlots = [];
    for (let i = 0; i < postCount; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      postSlots.push({
        x: side * 3.65,
        z: SCROLL_NEAR_Z - Math.floor(i / 2) * (spanM / (postCount / 2)),
      });
    }
    forestGroup.add(flowerMesh, postMesh);
    this.corridorGroup.add(forestGroup);
    this.forestLandmarks = { group: forestGroup, flowerMesh, flowerSlots, postMesh, postSlots };

    // 2. Coastal Sunset landmarks: Lighthouse on cliff + Sailboats on ocean + Boardwalk lanterns
    const coastalGroup = new THREE.Group();
    const lighthouse = new THREE.Group();
    const towerMat = this._makeLitMaterial(preset, { color: '#f8fafc' });
    const stripeMat = this._makeLitMaterial(preset, { color: '#ef4444' });
    const beaconMat = this._track(new THREE.MeshBasicMaterial({ color: '#fde047' }));
    const tower = new THREE.Mesh(this._track(new THREE.CylinderGeometry(1.1, 1.8, 12, 10)), towerMat);
    tower.position.set(0, 6, 0);
    const band = new THREE.Mesh(this._track(new THREE.CylinderGeometry(1.32, 1.5, 3.2, 10)), stripeMat);
    band.position.set(0, 6, 0);
    const lantern = new THREE.Mesh(this._track(new THREE.CylinderGeometry(1.0, 1.0, 1.8, 10)), beaconMat);
    lantern.position.set(0, 12.8, 0);
    const cap = new THREE.Mesh(this._track(new THREE.ConeGeometry(1.4, 2.0, 10)), stripeMat);
    cap.position.set(0, 14.6, 0);
    if (preset.shadows) tower.castShadow = true;
    lighthouse.add(tower, band, lantern, cap);
    lighthouse.position.set(-15, 0.8, -140);
    coastalGroup.add(lighthouse);

    const boats = [];
    const hullMat = this._makeLitMaterial(preset, { color: '#f8fafc' });
    const sailMat = this._makeLitMaterial(preset, { color: '#fffbeb', side: THREE.DoubleSide });
    for (let b = 0; b < 2; b += 1) {
      const boat = new THREE.Group();
      const hull = new THREE.Mesh(this._track(new THREE.BoxGeometry(1.6, 0.7, 4.4)), hullMat);
      hull.position.set(0, 0.2, 0);
      const sail = new THREE.Mesh(this._track(new THREE.ConeGeometry(1.5, 4.2, 3)), sailMat);
      sail.position.set(0, 2.5, 0);
      boat.add(hull, sail);
      const bx = b === 0 ? 18 : 34;
      const bz = b === 0 ? -70 : -165;
      boat.position.set(bx, -0.2, bz);
      coastalGroup.add(boat);
      boats.push({ mesh: boat, baseX: bx, z: bz, phase: b * 2.1 });
    }

    const lanternCount = 16;
    const lPostGeo = this._track(new THREE.CylinderGeometry(0.06, 0.08, 2.4, 6));
    const lPostMat = this._makeLitMaterial(preset, { color: '#334155' });
    const lPostMesh = new THREE.InstancedMesh(lPostGeo, lPostMat, lanternCount);
    const lBulbGeo = this._track(new THREE.SphereGeometry(0.22, 8, 6));
    const lBulbMat = this._track(new THREE.MeshBasicMaterial({ color: '#fde047' }));
    const lBulbMesh = new THREE.InstancedMesh(lBulbGeo, lBulbMat, lanternCount);
    const lanternSlots = [];
    for (let i = 0; i < lanternCount; i += 1) {
      lanternSlots.push({
        x: -3.65,
        z: SCROLL_NEAR_Z - (i / lanternCount) * spanM,
      });
    }
    coastalGroup.add(lPostMesh, lBulbMesh);
    this.corridorGroup.add(coastalGroup);
    this.coastalLandmarks = {
      group: coastalGroup,
      lighthouse,
      lighthouseZ: -140,
      boats,
      lPostMesh,
      lBulbMesh,
      lanternSlots,
    };

    // 3. Synthwave landmarks: Neon tunnel arches + floating spinning crystals
    const synthGroup = new THREE.Group();
    const neonArches = [];
    const pinkMat = this._track(new THREE.MeshBasicMaterial({ color: '#f472b6' }));
    const cyanMat = this._track(new THREE.MeshBasicMaterial({ color: '#22d3ee' }));
    const archGeo = this._track(new THREE.TorusGeometry(4.8, 0.14, 8, 24, Math.PI));
    for (let i = 0; i < 3; i += 1) {
      const m = new THREE.Mesh(archGeo, i % 2 === 0 ? pinkMat : cyanMat);
      const z = SCROLL_NEAR_Z - 35 - i * (spanM / 3);
      m.position.set(0, 0, z);
      synthGroup.add(m);
      neonArches.push({ mesh: m, z });
    }

    const crystalCount = 16;
    const crystalGeo = this._track(new THREE.OctahedronGeometry(0.75, 0));
    const crystalMat = this._track(
      new THREE.MeshBasicMaterial({ color: '#22d3ee', wireframe: true }),
    );
    const crystalMesh = new THREE.InstancedMesh(crystalGeo, crystalMat, crystalCount);
    const crystalSlots = [];
    for (let i = 0; i < crystalCount; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      crystalSlots.push({
        x: side * 5.2,
        z: SCROLL_NEAR_Z - (i / crystalCount) * spanM,
        phase: i * 0.7,
      });
    }
    synthGroup.add(crystalMesh);
    this.corridorGroup.add(synthGroup);
    this.synthLandmarks = {
      group: synthGroup,
      neonArches,
      crystalMesh,
      crystalSlots,
      dummy,
    };
  }

  _buildGhostPacer(preset) {
    const ghostGroup = new THREE.Group();
    const ghostMat = this._makeLitMaterial(preset, {
      color: '#38bdf8',
      emissive: '#0ea5e9',
      emissiveIntensity: 0.55,
      transparent: true,
      opacity: 0.88,
    });
    this.ghostMat = ghostMat;

    const head = new THREE.Mesh(this._track(new THREE.SphereGeometry(0.16, 12, 10)), ghostMat);
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

    if (preset.shadows) {
      head.castShadow = true;
      torso.castShadow = true;
      armL.castShadow = true;
      armR.castShadow = true;
      legL.castShadow = true;
      legR.castShadow = true;
    }

    const ringGeo = this._track(new THREE.RingGeometry(0.45, 0.62, 24));
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = this._track(
      new THREE.MeshBasicMaterial({
        color: '#38bdf8',
        transparent: true,
        opacity: 0.72,
        side: THREE.DoubleSide,
      }),
    );
    this.ghostRingMat = ringMat;
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(0, 0.03, 0);

    ghostGroup.add(head, torso, armL, armR, legL, legR, ring);
    ghostGroup.position.set(1.15, 0, -10);
    this.worldGroup.add(ghostGroup);
    this.ghostGroup = ghostGroup;
    this.ghostParts = { armL, armR, legL, legR };
  }

  _applyTheme() {
    const theme = WORLD_THEMES[this.themeKey] || WORLD_THEMES.forest;
    const preset = getQualityPreset(this.quality);

    if (this.skyTex) this.skyTex.dispose();
    this.skyTex = this._track(createSkyTexture(theme));
    this.scene.background = this.skyTex;
    this.scene.fog = new THREE.Fog(theme.fogColor, preset.fogNear, preset.fogFar);

    this.hemiLight.color.set(theme.hemiSky);
    this.hemiLight.groundColor.set(theme.hemiGround);
    this.sunLight.color.set(theme.sunColor);
    this.sunLight.intensity = theme.sunIntensity;

    if (this.sunDiscTex) this.sunDiscTex.dispose();
    this.sunDiscTex = this._track(createSunDiscTexture(theme));
    this.sunDiscMesh.material.map = this.sunDiscTex;
    this.sunDiscMesh.material.needsUpdate = true;

    if (this.sunHaloTex) this.sunHaloTex.dispose();
    this.sunHaloTex = this._track(createSunHaloTexture(theme));
    this.sunHaloMesh.material.map = this.sunHaloTex;
    this.sunHaloMesh.material.needsUpdate = true;

    if (this.roadTex) this.roadTex.dispose();
    this.roadTex = this._track(createRoadTexture(theme, this._spanM / ROAD_TILE_METERS));
    if (this.renderer) {
      this.roadTex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    }
    this.roadMesh.material.map = this.roadTex;
    this.roadMesh.material.needsUpdate = true;

    if (this.forestLandmarks) {
      this.forestLandmarks.group.visible = theme.key === 'forest';
    }
    if (this.coastalLandmarks) {
      this.coastalLandmarks.group.visible = theme.key === 'coastal';
    }
    if (this.synthLandmarks) {
      this.synthLandmarks.group.visible = theme.key === 'synthwave';
    }

    const isCoastal = theme.key === 'coastal';
    this.oceanMesh.visible = isCoastal;
    if (isCoastal) {
      if (this.oceanTex) this.oceanTex.dispose();
      this.oceanTex = this._track(createOceanTexture(this._spanM));
      this.oceanMesh.material.map = this.oceanTex;
      this.oceanMesh.material.needsUpdate = true;
    }

    if (theme.key === 'synthwave') {
      if (this.synthGridTex) this.synthGridTex.dispose();
      this.synthGridTex = this._track(createSynthGridTexture(theme, this._spanM));
      this.terrainMesh.material.map = this.synthGridTex;
      this.terrainMesh.material.emissive?.set('#1e1038');
    } else {
      this.terrainMesh.material.map = null;
      this.terrainMesh.material.emissive?.set('#000000');
    }
    this.terrainMesh.material.needsUpdate = true;

    this._rebuildTerrainForTheme(theme);

    if (this.mountainMat && this.mountainCapMat) {
      this.mountainMat.color.set(theme.mountainColor);
      this.mountainCapMat.color.set(theme.mountainCapColor);
    }

    if (this.cloudMesh) {
      this.cloudMesh.material.color.set(theme.cloudColor);
    }

    if (this.particlePoints) {
      this.particlePoints.material.color.set(theme.particleColor);
    }

    this.archMat.color.set(theme.archColor);
    this._refreshArchTexture(this._nextArchM, theme.archColor);

    this.ghostMat.color.set(theme.ghostColor);
    this.ghostMat.emissive.set(theme.ghostColor);
    this.ghostRingMat.color.set(theme.ghostColor);

    const trunkCol = new THREE.Color(theme.trunkColor);
    const canopyCol = new THREE.Color(theme.canopyColor);
    const canopyAltCol = new THREE.Color(theme.canopyAltColor);
    const propCol = new THREE.Color(theme.propColor);

    for (let i = 0; i < this._scenerySlots.length; i += 1) {
      this.trunkMesh.setColorAt(i, trunkCol);
      const cCol = this._scenerySlots[i].altShade ? canopyAltCol : canopyCol;
      this.canopyLowerMesh.setColorAt(i, cCol);
      this.canopyUpperMesh.setColorAt(i, cCol);
      this.propMesh.setColorAt(i, propCol);
    }
    if (this.trunkMesh.instanceColor) this.trunkMesh.instanceColor.needsUpdate = true;
    if (this.canopyLowerMesh.instanceColor) this.canopyLowerMesh.instanceColor.needsUpdate = true;
    if (this.canopyUpperMesh.instanceColor) this.canopyUpperMesh.instanceColor.needsUpdate = true;
    if (this.propMesh.instanceColor) this.propMesh.instanceColor.needsUpdate = true;

    if (this.grassMesh) {
      const grassCol = new THREE.Color(theme.grassColor);
      for (let i = 0; i < this._grassSlots.length; i += 1) {
        this.grassMesh.setColorAt(i, grassCol);
      }
      if (this.grassMesh.instanceColor) this.grassMesh.instanceColor.needsUpdate = true;
    }
  }

  _rebuildTerrainForTheme(theme) {
    const pos = this.terrainGeo.attributes.position;
    const col = this.terrainGeo.attributes.color;
    const primary = new THREE.Color(theme.terrainPrimary);
    const secondary = new THREE.Color(theme.terrainSecondary);
    const tmp = new THREE.Color();
    const isCoastal = theme.key === 'coastal';
    const isSynth = theme.key === 'synthwave';

    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const absX = Math.abs(x);

      let y = 0;
      if (absX > 4.6) {
        if (isCoastal && x > 4.6) {
          y = -0.35;
          tmp.copy(secondary);
        } else {
          const edge = (absX - 4.6) / 14;
          const wave = Math.sin(x * 0.16 + z * 0.08) * 1.6 + Math.cos(z * 0.1) * 1.1;
          y = Math.min(10.5, Math.max(0.05, edge * 1.7 + wave * Math.min(1, edge)));
          tmp.copy(isSynth ? new THREE.Color('#ffffff') : primary).lerp(
            isSynth ? new THREE.Color('#e2e8f0') : secondary,
            Math.min(0.65, edge * 0.16),
          );
        }
      } else {
        tmp.copy(isSynth ? new THREE.Color('#ffffff') : primary);
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
    const runnerDistanceM = t.distanceM ?? 0;

    // Stride camera bob phase
    const cadenceHz = Math.max(1.2, (t.cadenceSpm || 165) / 120);
    if (speedKph >= 0.5 && !this.manualPaused) {
      this._stridePhase += dt * cadenceHz * Math.PI * 2;
    }
    const bob = computeStrideBobOffset(this._stridePhase, speedKph, this.cameraBob);

    // Ghost Pacer computation
    const ghost = updateGhostPacer({
      runnerDistanceM,
      targetPaceSecPerKm: this.ghostPaceSecPerKm,
      elapsedSec: t.elapsedSec ?? 0,
      enabled: this.ghostEnabled,
    });
    if (ghost.visibleInRange && !this.manualPaused && t.recordingState === 'running') {
      this._ghostPhase += dt * 9.2;
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

    if (this.gpxRoute) {
      this._renderGpxFrame(dt, nowMs, runnerDistanceM, bob, ghost);
    } else {
      this._renderCorridorFrame(dt, nowMs, speedMps, inclinePct, runnerDistanceM, bob, ghost);
    }

    this.renderer.render(this.scene, this.camera);

    const instFps = 1 / Math.max(0.001, dt);
    const frameMs = dt * 1000;
    this._fpsEma = this._fpsEma * 0.88 + instFps * 0.12;
    this._frameMsEma = this._frameMsEma * 0.88 + frameMs * 0.12;
    if (nowMs - this._lastPerfEmitMs >= 500) {
      this._lastPerfEmitMs = nowMs;
      this.dispatchEvent(
        new CustomEvent('perfupdate', {
          detail: {
            fps: Math.round(this._fpsEma),
            frameMs: this._frameMsEma,
            calls: this.renderer.info.render.calls,
            triangles: this.renderer.info.render.triangles,
            quality: this.quality,
          },
        }),
      );
    }
  }

  _renderGpxFrame(dt, _nowMs, runnerDistanceM, bob, ghost) {
    const pos = sampleRouteAtDistance(this.gpxRoute, runnerDistanceM, { loop: true });
    const ahead = sampleRouteAtDistance(this.gpxRoute, runnerDistanceM + 22, { loop: true });

    this.camera.position.set(
      pos.x + pos.right[0] * bob.x,
      pos.y + 1.68 + bob.y,
      pos.z + pos.right[2] * bob.x,
    );
    this.camera.lookAt(ahead.x, ahead.y + 1.52, ahead.z);

    // Keep sun disc & directional shadows centered relative to the runner
    const sunDist = this._spanM - 25;
    this.sunDiscMesh.position.set(
      pos.x + pos.tangent[0] * sunDist,
      pos.y + 34,
      pos.z + pos.tangent[2] * sunDist,
    );
    this.sunDiscMesh.lookAt(this.camera.position);
    this.sunHaloMesh.position.copy(this.sunDiscMesh.position);
    this.sunHaloMesh.lookAt(this.camera.position);

    this.sunLight.position.set(pos.x + 28, pos.y + 46, pos.z + 36);
    this.sunLight.target.position.set(ahead.x, ahead.y, ahead.z);

    if (this.cloudMesh) {
      const dummy = this._dummy;
      for (let i = 0; i < this._cloudSlots.length; i += 1) {
        const c = this._cloudSlots[i];
        c.z = wrapScrollZ(c.z, dt * c.driftSpeed, this._spanM, SCROLL_NEAR_Z);
        dummy.position.set(pos.x + c.x, pos.y + c.y, pos.z + c.z);
        dummy.rotation.set(0, i * 0.4, 0);
        dummy.scale.set(c.sx, c.sy, c.sz);
        dummy.updateMatrix();
        this.cloudMesh.setMatrixAt(i, dummy.matrix);
      }
      this.cloudMesh.instanceMatrix.needsUpdate = true;
    }

    if (this.particlePoints) {
      this.particlePoints.position.set(pos.x, pos.y, pos.z);
    }

    this.ghostGroup.visible = ghost.visibleInRange;
    if (ghost.visibleInRange) {
      const gSmp = sampleRouteAtDistance(this.gpxRoute, ghost.ghostDistanceM, { loop: true });
      const gx = gSmp.x + gSmp.right[0] * 1.05;
      const gz = gSmp.z + gSmp.right[2] * 1.05;
      this.ghostGroup.position.set(gx, gSmp.y, gz);
      this.ghostGroup.lookAt(gx + gSmp.tangent[0], gSmp.y + gSmp.tangent[1], gz + gSmp.tangent[2]);
      const swing = Math.sin(this._ghostPhase) * 0.55;
      this.ghostParts.legL.rotation.x = swing;
      this.ghostParts.legR.rotation.x = -swing;
      this.ghostParts.armL.rotation.x = -swing * 0.8;
      this.ghostParts.armR.rotation.x = swing * 0.8;
    }
  }

  _renderCorridorFrame(dt, nowMs, speedMps, inclinePct, runnerDistanceM, bob, ghost) {
    this.camera.position.set(bob.x, 1.65 + bob.y, 0);
    this.camera.lookAt(0, 1.45, -45);
    this.sunLight.position.set(28, 46, 36);
    this.sunLight.target.position.set(0, 0, -35);
    if (this.particlePoints) {
      this.particlePoints.position.set(0, 0, 0);
    }

    const targetPitch = computeInclinePitchRad(inclinePct);
    this._pitchRad += (targetPitch - this._pitchRad) * Math.min(1, dt * 4.5);
    this.worldGroup.rotation.x = this._pitchRad;

    const sunY = 30 + Math.sin(this._pitchRad) * 80;
    this.sunDiscMesh.position.set(0, sunY, -(this._spanM - 16));
    this.sunDiscMesh.rotation.set(0, 0, 0);
    this.sunHaloMesh.position.set(0, sunY, -(this._spanM - 15));
    this.sunHaloMesh.rotation.set(0, 0, 0);

    const deltaZ = speedMps * dt;
    if (this.roadTex && deltaZ > 0) {
      this.roadTex.offset.y = (this.roadTex.offset.y + deltaZ / ROAD_TILE_METERS) % 1;
    }
    if (this.oceanTex && this.oceanMesh.visible) {
      this.oceanTex.offset.y = (this.oceanTex.offset.y + (deltaZ + dt * 0.8) / 14) % 1;
    }
    if (this.synthGridTex && this.themeKey === 'synthwave' && deltaZ > 0) {
      this.synthGridTex.offset.y = (this.synthGridTex.offset.y + deltaZ / 8) % 1;
    }

    const isCoastal = this.themeKey === 'coastal';
    const dummy = this._dummy;
    const spanM = this._spanM;

    for (let i = 0; i < this._scenerySlots.length; i += 1) {
      const slot = this._scenerySlots[i];
      slot.z = wrapScrollZ(slot.z, deltaZ, spanM, SCROLL_NEAR_Z);
      slot.propZ = wrapScrollZ(slot.propZ, deltaZ, spanM, SCROLL_NEAR_Z);

      const effectiveX = isCoastal && slot.x > 4.6 ? -slot.x : slot.x;
      const s = slot.scale;

      dummy.position.set(effectiveX, 1.1 * s, slot.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      this.trunkMesh.setMatrixAt(i, dummy.matrix);

      dummy.position.set(effectiveX, 2.55 * s, slot.z);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      this.canopyLowerMesh.setMatrixAt(i, dummy.matrix);

      dummy.position.set(effectiveX, 3.85 * s, slot.z);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      this.canopyUpperMesh.setMatrixAt(i, dummy.matrix);

      const propEffectiveX = isCoastal && slot.propX > 4.6 ? -slot.propX : slot.propX;
      dummy.position.set(propEffectiveX, 0.34 * slot.propScale, slot.propZ);
      dummy.rotation.set(0.2, i * 0.7, 0.1);
      dummy.scale.set(slot.propScale, slot.propScale, slot.propScale);
      dummy.updateMatrix();
      this.propMesh.setMatrixAt(i, dummy.matrix);
    }
    this.trunkMesh.instanceMatrix.needsUpdate = true;
    this.canopyLowerMesh.instanceMatrix.needsUpdate = true;
    this.canopyUpperMesh.instanceMatrix.needsUpdate = true;
    this.propMesh.instanceMatrix.needsUpdate = true;

    if (this.grassMesh) {
      for (let i = 0; i < this._grassSlots.length; i += 1) {
        const g = this._grassSlots[i];
        g.z = wrapScrollZ(g.z, deltaZ, spanM, SCROLL_NEAR_Z);
        const gx = isCoastal && g.x > 3.6 ? -g.x : g.x;
        dummy.position.set(gx, 0.36 * g.scale, g.z);
        dummy.rotation.set(0, i * 0.5, g.tilt);
        dummy.scale.set(g.scale, g.scale, g.scale);
        dummy.updateMatrix();
        this.grassMesh.setMatrixAt(i, dummy.matrix);
      }
      this.grassMesh.instanceMatrix.needsUpdate = true;
    }

    // Theme-specific Phase 2A landmarks
    if (this.forestLandmarks && this.forestLandmarks.group.visible) {
      const fl = this.forestLandmarks;
      for (let i = 0; i < fl.flowerSlots.length; i += 1) {
        const f = fl.flowerSlots[i];
        f.z = wrapScrollZ(f.z, deltaZ, spanM, SCROLL_NEAR_Z);
        dummy.position.set(f.x, 0.16 * f.scale, f.z);
        dummy.rotation.set(0, i * 0.6, 0);
        dummy.scale.set(f.scale, f.scale, f.scale);
        dummy.updateMatrix();
        fl.flowerMesh.setMatrixAt(i, dummy.matrix);
      }
      fl.flowerMesh.instanceMatrix.needsUpdate = true;

      for (let i = 0; i < fl.postSlots.length; i += 1) {
        const p = fl.postSlots[i];
        p.z = wrapScrollZ(p.z, deltaZ, spanM, SCROLL_NEAR_Z);
        dummy.position.set(p.x, 0.45, p.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        fl.postMesh.setMatrixAt(i, dummy.matrix);
      }
      fl.postMesh.instanceMatrix.needsUpdate = true;
    }

    if (this.coastalLandmarks && this.coastalLandmarks.group.visible) {
      const cl = this.coastalLandmarks;
      cl.lighthouseZ = wrapScrollZ(cl.lighthouseZ, deltaZ, spanM, SCROLL_NEAR_Z);
      cl.lighthouse.position.z = cl.lighthouseZ;
      for (const b of cl.boats) {
        b.z = wrapScrollZ(b.z, deltaZ * 0.72 + dt * 0.8, spanM, SCROLL_NEAR_Z);
        b.mesh.position.set(b.baseX, -0.18 + Math.sin(nowMs * 0.002 + b.phase) * 0.08, b.z);
        b.mesh.rotation.z = Math.sin(nowMs * 0.0016 + b.phase) * 0.06;
      }
      for (let i = 0; i < cl.lanternSlots.length; i += 1) {
        const l = cl.lanternSlots[i];
        l.z = wrapScrollZ(l.z, deltaZ, spanM, SCROLL_NEAR_Z);
        dummy.position.set(l.x, 1.2, l.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        cl.lPostMesh.setMatrixAt(i, dummy.matrix);
        dummy.position.set(l.x, 2.5, l.z);
        dummy.updateMatrix();
        cl.lBulbMesh.setMatrixAt(i, dummy.matrix);
      }
      cl.lPostMesh.instanceMatrix.needsUpdate = true;
      cl.lBulbMesh.instanceMatrix.needsUpdate = true;
    }

    if (this.synthLandmarks && this.synthLandmarks.group.visible) {
      const sl = this.synthLandmarks;
      for (const a of sl.neonArches) {
        a.z = wrapScrollZ(a.z, deltaZ, spanM, SCROLL_NEAR_Z);
        a.mesh.position.z = a.z;
      }
      for (let i = 0; i < sl.crystalSlots.length; i += 1) {
        const c = sl.crystalSlots[i];
        c.z = wrapScrollZ(c.z, deltaZ, spanM, SCROLL_NEAR_Z);
        dummy.position.set(c.x, 2.6 + Math.sin(nowMs * 0.0022 + c.phase) * 0.45, c.z);
        dummy.rotation.set(nowMs * 0.001, nowMs * 0.0014 + c.phase, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        sl.crystalMesh.setMatrixAt(i, dummy.matrix);
      }
      sl.crystalMesh.instanceMatrix.needsUpdate = true;
    }

    if (this.cloudMesh) {
      for (let i = 0; i < this._cloudSlots.length; i += 1) {
        const c = this._cloudSlots[i];
        c.z = wrapScrollZ(c.z, deltaZ * 0.18 + dt * c.driftSpeed, spanM, SCROLL_NEAR_Z);
        dummy.position.set(c.x, c.y, c.z);
        dummy.rotation.set(0, i * 0.4, 0);
        dummy.scale.set(c.sx, c.sy, c.sz);
        dummy.updateMatrix();
        this.cloudMesh.setMatrixAt(i, dummy.matrix);
      }
      this.cloudMesh.instanceMatrix.needsUpdate = true;
    }

    if (this.particlePoints && this.particlePositions) {
      const pSpan = spanM * 0.45;
      const pPos = this.particlePositions;
      for (let i = 0; i < pPos.length; i += 3) {
        pPos[i] += Math.sin(nowMs * 0.001 + i) * 0.006;
        pPos[i + 1] += Math.cos(nowMs * 0.0013 + i) * 0.004;
        pPos[i + 2] = wrapScrollZ(pPos[i + 2], deltaZ + dt * 0.5, pSpan, SCROLL_NEAR_Z);
      }
      this.particlePoints.geometry.attributes.position.needsUpdate = true;
    }

    const nextArch = computeNextArchDistanceM(runnerDistanceM, 500);
    if (nextArch !== this._nextArchM) {
      this._nextArchM = nextArch;
      const theme = WORLD_THEMES[this.themeKey] || WORLD_THEMES.forest;
      this._refreshArchTexture(nextArch, theme.archColor);
    }
    const archZ = -(this._nextArchM - runnerDistanceM);
    this.archGroup.visible = archZ >= -(spanM - 30) && archZ <= 15;
    this.archGroup.position.set(0, 0, archZ);

    this.ghostGroup.visible = ghost.visibleInRange;
    if (ghost.visibleInRange) {
      this.ghostGroup.position.set(1.15, 0, ghost.zOffset);
      this.ghostGroup.rotation.set(0, 0, 0);
      const swing = Math.sin(this._ghostPhase) * 0.55;
      this.ghostParts.legL.rotation.x = swing;
      this.ghostParts.legR.rotation.x = -swing;
      this.ghostParts.armL.rotation.x = -swing * 0.8;
      this.ghostParts.armR.rotation.x = swing * 0.8;
    }
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
