/**
 * Bright, multi-tier Three.js 3D Runner View (Phase 2A):
 * - Low (battery/max FPS), Medium (Lenovo Duet default), High (Gaming PC Ultra w/ shadows & particles)
 * - Hemisphere + front-3/4 sunlight + ACESFilmicToneMapping for crisp, sunlit scenes
 * - 3 live-switchable themes (Forest Trail, Coastal Sunset, Synthwave Grid)
 * - Dynamic incline pitch, 500 m milestone arches, toggleable stride bob, and Ghost Pacer
 */

import * as THREE from '../../vendor/three.module.min.js';
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

function createRoadTexture(theme, spanM) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = theme.roadBase;
  ctx.fillRect(0, 0, 512, 512);

  // Surface texture grain / boardwalk planks
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

  // Bright edge shoulders
  ctx.fillStyle = theme.roadShoulder;
  ctx.fillRect(18, 0, 14, 512);
  ctx.fillRect(480, 0, 14, 512);

  // Center dashed line
  ctx.fillStyle = theme.roadStripe;
  ctx.fillRect(248, 34, 16, 190);
  ctx.fillRect(248, 290, 16, 190);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, spanM / ROAD_TILE_METERS);
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
  } = {}) {
    super();
    this.themeKey = WORLD_THEMES[theme] ? theme : 'forest';
    this.quality = QUALITY_PRESETS[quality] ? quality : 'medium';
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
    this._spanM = 285;
    this._disposables = [];

    // Three.js handles
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.worldGroup = null;
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

  _makeLitMaterial(preset, params = {}) {
    if (preset.useStandardMaterials) {
      return this._track(
        new THREE.MeshStandardMaterial({
          roughness: 0.78,
          metalness: 0.06,
          ...params,
        }),
      );
    }
    return this._track(new THREE.MeshLambertMaterial(params));
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

    const camera = new THREE.PerspectiveCamera(62, width / height, 0.2, spanM + 40);
    camera.position.set(0, 1.65, 0);
    camera.lookAt(0, 1.45, -45);
    this.camera = camera;

    // Bright daylight / twilight hemisphere + front-3/4 sun
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

    // Radiant Sun Disc + Halo
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

    // Road ribbon
    const roadGeo = this._track(new THREE.PlaneGeometry(6.6, spanM, 1, 1));
    roadGeo.rotateX(-Math.PI / 2);
    const roadMat = this._makeLitMaterial(preset, { color: '#ffffff', roughness: 0.86 });
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.position.set(0, 0, SCROLL_NEAR_Z - spanM / 2);
    roadMesh.receiveShadow = preset.shadows;
    worldGroup.add(roadMesh);
    this.roadMesh = roadMesh;

    // Sculpted terrain corridor
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
    worldGroup.add(terrainMesh);
    this.terrainGeo = terrainGeo;
    this.terrainMesh = terrainMesh;

    // Dedicated shimmering ocean plane (shown in Coastal theme)
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
    worldGroup.add(oceanMesh);
    this.oceanMesh = oceanMesh;

    // Pooled instanced scenery (trunks + 2-tier canopies + props)
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

    worldGroup.add(this.trunkMesh, this.canopyLowerMesh, this.canopyUpperMesh, this.propMesh);

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

    // Medium & High: roadside grass tufts / neon crystals
    if (preset.grassCount > 0) {
      const grassGeo = this._track(new THREE.ConeGeometry(0.24, 0.75, 4));
      const grassMat = this._makeLitMaterial(preset, { color: '#ffffff' });
      this.grassMesh = new THREE.InstancedMesh(grassGeo, grassMat, preset.grassCount);
      worldGroup.add(this.grassMesh);

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

    // Medium & High: distant mountain ridge & drifting sky clouds
    if (preset.key !== 'low') {
      this._buildMountains(preset, spanM);
      this._buildClouds(preset, spanM);
    }

    // High: sunlit pollen / sea-spray / neon atmospheric particles
    if (preset.particleCount > 0) {
      this._buildParticles(preset.particleCount, spanM);
    }

    this._buildArch(preset);
    this._buildGhostPacer(preset);
    this._applyTheme();

    this._resizeObserver = new ResizeObserver(() => this._handleResize());
    this._resizeObserver.observe(stage);
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

    this.worldGroup.add(group);
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
    this.worldGroup.add(archGroup);
    this.archGroup = archGroup;
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
    this.roadTex = this._track(createRoadTexture(theme, this._spanM));
    this.roadMesh.material.map = this.roadTex;
    this.roadMesh.material.needsUpdate = true;

    // Coastal ocean visibility & texture
    const isCoastal = theme.key === 'coastal';
    this.oceanMesh.visible = isCoastal;
    if (isCoastal) {
      if (this.oceanTex) this.oceanTex.dispose();
      this.oceanTex = this._track(createOceanTexture(this._spanM));
      this.oceanMesh.material.map = this.oceanTex;
      this.oceanMesh.material.needsUpdate = true;
    }

    // Synthwave grid overlay vs vertex-colored terrain
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

    // Smooth incline road tilt
    const targetPitch = computeInclinePitchRad(inclinePct);
    this._pitchRad += (targetPitch - this._pitchRad) * Math.min(1, dt * 4.5);
    this.worldGroup.rotation.x = this._pitchRad;

    const sunY = 30 + Math.sin(this._pitchRad) * 80;
    this.sunDiscMesh.position.y = sunY;
    this.sunHaloMesh.position.y = sunY;

    // Scroll road, ocean, and synthwave grid
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

    // Update instanced trees/pylons/props
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

    // Roadside grass tufts / crystals (Medium & High)
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

    // Drifting sky clouds (Medium & High)
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

    // Atmospheric particles (High)
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

    // 500m Milestone Arch
    const runnerDistanceM = t.distanceM ?? 0;
    const nextArch = computeNextArchDistanceM(runnerDistanceM, 500);
    if (nextArch !== this._nextArchM) {
      this._nextArchM = nextArch;
      const theme = WORLD_THEMES[this.themeKey] || WORLD_THEMES.forest;
      this._refreshArchTexture(nextArch, theme.archColor);
    }
    const archZ = -(this._nextArchM - runnerDistanceM);
    this.archGroup.visible = archZ >= -(spanM - 30) && archZ <= 15;
    this.archGroup.position.set(0, 0, archZ);

    // Ghost Pacer
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

    // Stride camera bob
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
