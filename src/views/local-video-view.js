/**
 * Local HTML5 Video View supporting continuous smooth playbackRate scaling (0.25x - 2.00x)
 * and 100% offline playback on the Lenovo Duet.
 */

import { mapSpeedToPlaybackRate } from './view-manager.js';

export class LocalVideoView extends EventTarget {
  constructor() {
    super();
    this.container = null;
    this.videoEl = null;
    this.emptyEl = null;
    this.objectUrl = null;
    this.fileName = '';
    this.muted = true;
    this.manualPaused = false;
    this.currentRate = 1.0;
    this._lastShouldPlay = null;
  }

  async mount(container, { muted = true, manualPaused = false } = {}) {
    this.container = container;
    this.muted = muted;
    this.manualPaused = manualPaused;
    this._lastShouldPlay = null;

    container.innerHTML = '';

    const stage = document.createElement('div');
    stage.className = 'video-stage local-stage';

    const video = document.createElement('video');
    video.className = 'local-video-el';
    video.playsInline = true;
    video.loop = true;
    video.muted = this.muted;
    video.controls = false;
    if (this.objectUrl) {
      video.src = this.objectUrl;
    }
    this.videoEl = video;
    stage.appendChild(video);

    const empty = document.createElement('div');
    empty.className = this.objectUrl ? 'local-empty hidden' : 'local-empty';
    empty.innerHTML = `
      <div class="local-empty-card">
        <h2>Local POV Video Mode</h2>
        <p>Load any downloaded <code>.mp4</code> or <code>.webm</code> running video for smooth continuous speed scaling and 100% offline use.</p>
        <button type="button" class="btn btn-primary" data-pick-local-video>Choose Video File</button>
      </div>
    `;
    empty.querySelector('[data-pick-local-video]')?.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('requestfile'));
    });
    this.emptyEl = empty;
    stage.appendChild(empty);

    container.appendChild(stage);
  }

  async unmount() {
    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.removeAttribute('src');
      this.videoEl.load();
      this.videoEl = null;
    }
    this.emptyEl = null;
    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
    }
  }

  loadFile(file) {
    if (!file) {
      return;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
    }
    this.objectUrl = URL.createObjectURL(file);
    this.fileName = file.name;

    if (this.videoEl) {
      this.videoEl.src = this.objectUrl;
      this.videoEl.muted = this.muted;
      this.videoEl.play().catch(() => {});
    }
    if (this.emptyEl) {
      this.emptyEl.classList.add('hidden');
    }
    this.dispatchEvent(new CustomEvent('fileloaded', { detail: { name: file.name } }));
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.videoEl) {
      this.videoEl.muted = this.muted;
    }
  }

  setManualPaused(paused) {
    this.manualPaused = Boolean(paused);
    if (this.videoEl && this.manualPaused) {
      this.videoEl.pause();
      this._lastShouldPlay = false;
    }
  }

  update(telemetryState, _dtSec, { baseSpeedKph = 10, manualPaused = false } = {}) {
    if (!this.videoEl || !this.objectUrl) {
      return;
    }
    if (manualPaused) {
      if (this._lastShouldPlay !== false) {
        this.videoEl.pause();
        this._lastShouldPlay = false;
      }
      return;
    }

    const speedForVideo = telemetryState.smoothedSpeedKph ?? telemetryState.speedKph ?? 0;
    const mapped = mapSpeedToPlaybackRate({
      speedKph: speedForVideo,
      baseSpeedKph,
      currentRate: this.currentRate,
      mode: 'continuous',
      stoppedSec: telemetryState.stoppedSec ?? 0,
    });

    if (Math.abs(mapped.rate - this.currentRate) >= 0.02) {
      this.currentRate = mapped.rate;
      this.videoEl.playbackRate = mapped.rate;
      this.dispatchEvent(new CustomEvent('ratechange', { detail: { rate: mapped.rate } }));
    }

    if (mapped.shouldPlay !== this._lastShouldPlay) {
      this._lastShouldPlay = mapped.shouldPlay;
      if (mapped.shouldPlay) {
        this.videoEl.play().catch(() => {});
      } else {
        this.videoEl.pause();
      }
    }
  }
}
