/**
 * YouTube POV View using standard youtube.com IFrame API (preserving YouTube
 * Premium Lite ad-free ChromeOS login) with discrete 0.25x hysteresis scaling.
 */

import { mapSpeedToPlaybackRate, parseYoutubeVideoId } from './view-manager.js';

export const YOUTUBE_PRESETS = Object.freeze([
  {
    id: 'RM_Btl6QDgg',
    title: 'Sunny Forest Trail Run — St Leonard\'s Forest (50m 4K POV)',
    baseKph: 10.0,
  },
  {
    id: 'YYO3GXyodyI',
    title: 'Smooth Spring Countryside Run — Colliers Way (60m 4K POV)',
    baseKph: 10.0,
  },
  {
    id: 'MEtXwpHy_KA',
    title: 'Seceda Ridgeline, Italian Dolomites (50m 4K POV)',
    baseKph: 10.0,
  },
  {
    id: 't8ge87w70Tc',
    title: 'Otago Peninsula Coastal Run, NZ (40m 4K 60fps POV)',
    baseKph: 10.0,
  },
  {
    id: 'CTXzFKcrgzY',
    title: 'Joshua Tree National Park at Sunset (4K POV)',
    baseKph: 10.0,
  },
]);

let ytApiPromise = null;

function loadYoutubeIframeApi() {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }
  if (ytApiPromise) {
    return ytApiPromise;
  }

  ytApiPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ytApiPromise = null;
      reject(new Error('YouTube IFrame API timed out (offline or blocked).'));
    }, 10000);

    const prevReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timeout);
      if (typeof prevReady === 'function') {
        prevReady();
      }
      resolve(window.YT);
    };

    const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (!existing) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => {
        clearTimeout(timeout);
        ytApiPromise = null;
        reject(new Error('Failed to load YouTube IFrame API.'));
      };
      document.head.appendChild(script);
    }
  });

  return ytApiPromise;
}

export class YouTubeView extends EventTarget {
  constructor({ videoId = YOUTUBE_PRESETS[0].id } = {}) {
    super();
    this.videoId = videoId;
    this.container = null;
    this.player = null;
    this.ready = false;
    this.muted = true;
    this.manualPaused = false;
    this.currentRate = 1.0;
    this._lastShouldPlay = null;
    this._mounted = false;
    this._bannerEl = null;
    this._playerHostEl = null;
  }

  async mount(container, { muted = true, manualPaused = false } = {}) {
    this._mounted = true;
    this.container = container;
    this.muted = muted;
    this.manualPaused = manualPaused;
    this.ready = false;
    this._lastShouldPlay = null;

    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'video-stage youtube-stage';

    const iframe = document.createElement('iframe');
    iframe.id = `yt-player-${Date.now()}`;
    iframe.className = 'youtube-frame';
    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    iframe.setAttribute(
      'allow',
      'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
    );
    iframe.setAttribute('allowfullscreen', '');
    iframe.src = this._buildEmbedUrl(this.videoId);
    wrapper.appendChild(iframe);
    this._playerHostEl = iframe;

    const banner = document.createElement('div');
    banner.className = 'view-banner hidden';
    wrapper.appendChild(banner);
    this._bannerEl = banner;

    container.appendChild(wrapper);
    this._showBanner('Loading YouTube POV player...', 'info');

    try {
      const YT = await loadYoutubeIframeApi();
      if (!this._mounted) {
        return;
      }

      this.player = new YT.Player(iframe.id, {
        events: {
          onReady: () => this._handleReady(),
          onError: (e) => this._handleError(e?.data),
        },
      });
    } catch (err) {
      this._showBanner(
        `${err.message} Switch to Local MP4 in the top bar for 100% offline playback.`,
        'warn',
      );
    }
  }

  _buildEmbedUrl(videoId) {
    const params = new URLSearchParams({
      enablejsapi: '1',
      autoplay: '1',
      controls: '1',
      mute: this.muted ? '1' : '0',
      playsinline: '1',
      rel: '0',
      modestbranding: '1',
      iv_load_policy: '3',
    });
    if (window.location.origin.startsWith('http')) {
      params.set('origin', window.location.origin);
    }
    return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
  }

  async unmount() {
    this._mounted = false;
    this.ready = false;
    if (this.player) {
      try {
        this.player.destroy();
      } catch {
        // Ignore teardown error.
      }
      this.player = null;
    }
    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
    }
  }

  setVideo(input) {
    const id = parseYoutubeVideoId(input);
    if (!id) {
      return false;
    }
    this.videoId = id;
    if (this.ready && this.player?.loadVideoById) {
      this._hideBanner();
      this.player.loadVideoById(id);
      if (this.muted) {
        this.player.mute();
      }
    } else if (this._mounted && this.container) {
      this.mount(this.container, { muted: this.muted, manualPaused: this.manualPaused });
    }
    return true;
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (!this.ready || !this.player) {
      return;
    }
    if (this.muted) {
      this.player.mute();
    } else {
      this.player.unMute();
    }
  }

  setManualPaused(paused) {
    this.manualPaused = Boolean(paused);
    if (!this.ready || !this.player) {
      return;
    }
    if (this.manualPaused) {
      this.player.pauseVideo();
      this._lastShouldPlay = false;
    }
  }

  update(telemetryState, _dtSec, { baseSpeedKph = 10, manualPaused = false } = {}) {
    if (!this.ready || !this.player) {
      return;
    }
    if (manualPaused) {
      if (this._lastShouldPlay !== false) {
        this.player.pauseVideo();
        this._lastShouldPlay = false;
      }
      return;
    }

    const speedForVideo = telemetryState.smoothedSpeedKph ?? telemetryState.speedKph ?? 0;
    const mapped = mapSpeedToPlaybackRate({
      speedKph: speedForVideo,
      baseSpeedKph,
      currentRate: this.currentRate,
      mode: 'discrete',
      stoppedSec: telemetryState.stoppedSec ?? 0,
    });

    if (mapped.rate !== this.currentRate) {
      this.currentRate = mapped.rate;
      try {
        this.player.setPlaybackRate(mapped.rate);
      } catch {
        // Ignore transient YT API error.
      }
      this.dispatchEvent(new CustomEvent('ratechange', { detail: { rate: mapped.rate } }));
    }

    if (mapped.shouldPlay !== this._lastShouldPlay) {
      this._lastShouldPlay = mapped.shouldPlay;
      try {
        if (mapped.shouldPlay) {
          this.player.playVideo();
        } else {
          this.player.pauseVideo();
        }
      } catch {
        // Ignore transient YT API error.
      }
    }
  }

  _handleReady() {
    if (!this._mounted) {
      return;
    }
    this.ready = true;
    this._hideBanner();
    this.setMuted(this.muted);
    if (this.manualPaused) {
      this.player.pauseVideo();
      this._lastShouldPlay = false;
    } else {
      this.player.playVideo();
      this._lastShouldPlay = true;
    }
    this.dispatchEvent(new CustomEvent('ratechange', { detail: { rate: this.currentRate } }));
  }

  _handleError(code) {
    let msg;
    if (code === 100) {
      msg = 'YouTube video unavailable or removed (code 100). Choose another preset or paste a new POV URL.';
    } else if (code === 101 || code === 150) {
      msg = `Video owner disabled embedding (code ${code}). Choose another preset, paste another POV URL, or use Local MP4.`;
    } else if (code === 153) {
      msg = 'YouTube player rejected the referrer header (code 153). Disable strict referrer blocking on localhost or switch to Local MP4.';
    } else {
      msg = `YouTube player error (${code ?? 'unknown'}). Try another video or switch to Local MP4.`;
    }
    this._showBanner(msg, 'warn');
  }

  _showBanner(text, level = 'info') {
    if (!this._bannerEl) {
      return;
    }
    this._bannerEl.textContent = text;
    this._bannerEl.className = `view-banner ${level}`;
  }

  _hideBanner() {
    if (!this._bannerEl) {
      return;
    }
    this._bannerEl.className = 'view-banner hidden';
  }
}
