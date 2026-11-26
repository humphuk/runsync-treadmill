/**
 * Live 2D Route Mini-Map SVG Widget (Phase 2B Polish).
 * Renders the full GPX loop path, Start/Finish pin, Runner dot, and Ghost Pacer dot.
 */

import { sampleRouteAtDistance } from '../world/gpx-route.js';

export class RouteMiniMapWidget {
  constructor(containerEl) {
    this.container = containerEl;
    this.route = null;
    this._els = null;
    this._proj = null;
  }

  setRoute(route) {
    this.route = route || null;
    if (!this.route) {
      this.clear();
      return;
    }

    const samples = this.route.samples;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (const s of samples) {
      if (s.x < minX) minX = s.x;
      if (s.x > maxX) maxX = s.x;
      if (s.z < minZ) minZ = s.z;
      if (s.z > maxZ) maxZ = s.z;
    }

    const size = 136;
    const pad = 14;
    const spanX = Math.max(10, maxX - minX);
    const spanZ = Math.max(10, maxZ - minZ);
    const scale = (size - pad * 2) / Math.max(spanX, spanZ);
    const offX = (size - spanX * scale) * 0.5;
    const offY = (size - spanZ * scale) * 0.5;

    const project = (x, z) => ({
      px: offX + (x - minX) * scale,
      py: offY + (z - minZ) * scale,
    });
    this._proj = project;

    const step = Math.max(1, Math.floor(samples.length / 160));
    const pts = [];
    for (let i = 0; i < samples.length; i += step) {
      const { px, py } = project(samples[i].x, samples[i].z);
      pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
    }
    const last = samples[samples.length - 1];
    const lastP = project(last.x, last.z);
    pts.push(`${lastP.px.toFixed(1)},${lastP.py.toFixed(1)}`);

    const startP = project(samples[0].x, samples[0].z);
    const polyPoints = pts.join(' ');

    this.container.innerHTML = `
      <svg class="minimap-svg" viewBox="0 0 ${size} ${size}" aria-hidden="true">
        <polyline points="${polyPoints}" fill="none" stroke="rgba(11,16,32,0.8)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />
        <polyline points="${polyPoints}" fill="none" stroke="#38bdf8" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="${startP.px.toFixed(1)}" cy="${startP.py.toFixed(1)}" r="4" fill="#22c55e" stroke="#0b1020" stroke-width="1.4" />
        <circle class="hidden" data-mm-ghost cx="${startP.px.toFixed(1)}" cy="${startP.py.toFixed(1)}" r="4.8" fill="#fbbf24" stroke="#0b1020" stroke-width="1.4" />
        <circle data-mm-runner cx="${startP.px.toFixed(1)}" cy="${startP.py.toFixed(1)}" r="5.5" fill="#34d399" stroke="#ffffff" stroke-width="2" />
      </svg>
    `;

    this._els = {
      runner: this.container.querySelector('[data-mm-runner]'),
      ghost: this.container.querySelector('[data-mm-ghost]'),
    };
    this.container.classList.remove('hidden');
  }

  update({ distanceM = 0, ghostDistanceM = 0, ghostEnabled = false } = {}) {
    if (!this.route || !this._els || !this._proj) {
      return;
    }

    const rSmp = sampleRouteAtDistance(this.route, distanceM, { loop: true });
    const rPt = this._proj(rSmp.x, rSmp.z);
    this._els.runner.setAttribute('cx', rPt.px.toFixed(1));
    this._els.runner.setAttribute('cy', rPt.py.toFixed(1));

    if (ghostEnabled) {
      const gSmp = sampleRouteAtDistance(this.route, ghostDistanceM, { loop: true });
      const gPt = this._proj(gSmp.x, gSmp.z);
      this._els.ghost.setAttribute('cx', gPt.px.toFixed(1));
      this._els.ghost.setAttribute('cy', gPt.py.toFixed(1));
      this._els.ghost.classList.remove('hidden');
    } else {
      this._els.ghost.classList.add('hidden');
    }
  }

  clear() {
    this.route = null;
    this._els = null;
    this._proj = null;
    this.container.innerHTML = '';
    this.container.classList.add('hidden');
  }
}
