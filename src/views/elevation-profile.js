/**
 * 2D SVG Elevation Profile Widget (Phase 2B) displaying live route elevation,
 * current grade %, remaining distance, upcoming incline cue, Runner dot, and Ghost dot.
 */

export class ElevationProfileWidget {
  constructor(containerEl) {
    this.container = containerEl;
    this.route = null;
    this._els = null;
  }

  setRoute(route) {
    this.route = route || null;
    if (!this.route) {
      this.clear();
      return;
    }

    const samples = this.route.samples;
    const totalM = Math.max(1, this.route.totalDistanceM);
    const minE = this.route.minEleM;
    const spanE = Math.max(8, this.route.maxEleM - minE);
    const W = 600;
    const H = 64;
    const padTop = 6;
    const padBot = 4;
    const usableH = H - padTop - padBot;

    // Decimate to <= 180 SVG points for fast rendering
    const step = Math.max(1, Math.floor(samples.length / 180));
    const pts = [];
    for (let i = 0; i < samples.length; i += step) {
      const s = samples[i];
      const x = (s.s / totalM) * W;
      const y = padTop + (1 - (s.eleM - minE) / spanE) * usableH;
      pts.push({ x, y });
    }
    const last = samples[samples.length - 1];
    pts.push({
      x: W,
      y: padTop + (1 - (last.eleM - minE) / spanE) * usableH,
    });

    const linePath = pts
      .map((p, idx) => `${idx === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(' ');
    const areaPath = `${linePath} L${W},${H} L0,${H} Z`;

    this.container.innerHTML = `
      <div class="gpx-bar-head">
        <div class="gpx-title-wrap">
          <span class="gpx-name">${this._escape(this.route.name)}</span>
          <span class="gpx-grade-chip" data-gpx-grade>0.0%</span>
          <span class="gpx-cue-chip hidden" data-gpx-cue></span>
        </div>
        <span class="gpx-meta" data-gpx-rem>${(totalM / 1000).toFixed(2)} km · +${Math.round(this.route.totalAscentM)} m</span>
      </div>
      <svg class="gpx-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="gpxGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.55" />
            <stop offset="100%" stop-color="#34d399" stop-opacity="0.08" />
          </linearGradient>
        </defs>
        <path d="${areaPath}" fill="url(#gpxGrad)" />
        <path d="${linePath}" fill="none" stroke="#38bdf8" stroke-width="2.2" />
        <circle class="gpx-ghost-dot hidden" data-gpx-ghost cx="0" cy="32" r="5" fill="#fbbf24" stroke="#0b1020" stroke-width="1.5" />
        <circle class="gpx-runner-dot" data-gpx-runner cx="0" cy="32" r="5.5" fill="#34d399" stroke="#ffffff" stroke-width="2" />
      </svg>
    `;

    this._els = {
      grade: this.container.querySelector('[data-gpx-grade]'),
      cue: this.container.querySelector('[data-gpx-cue]'),
      rem: this.container.querySelector('[data-gpx-rem]'),
      runner: this.container.querySelector('[data-gpx-runner]'),
      ghost: this.container.querySelector('[data-gpx-ghost]'),
      W,
      H,
      padTop,
      usableH,
      minE,
      spanE,
      totalM,
    };

    this.container.classList.remove('hidden');
  }

  update({
    distanceM = 0,
    eleM = null,
    gradePct = 0,
    ghostDistanceM = 0,
    ghostEleM = null,
    ghostEnabled = false,
    upcomingCue = '',
  } = {}) {
    if (!this.route || !this._els) {
      return;
    }

    const { W, padTop, usableH, minE, spanE, totalM } = this._els;
    const loopDist = ((distanceM % totalM) + totalM) % totalM;
    const rx = (loopDist / totalM) * W;
    const rEle = eleM ?? minE;
    const ry = padTop + (1 - (rEle - minE) / spanE) * usableH;

    this._els.runner.setAttribute('cx', rx.toFixed(1));
    this._els.runner.setAttribute('cy', ry.toFixed(1));

    const sign = gradePct >= 0.1 ? '+' : '';
    this._els.grade.textContent = `${sign}${gradePct.toFixed(1)}%`;
    this._els.grade.classList.toggle('climb', gradePct >= 2.5);
    this._els.grade.classList.toggle('descent', gradePct <= -2.0);

    const remKm = Math.max(0, (totalM - loopDist) / 1000);
    this._els.rem.textContent = `${remKm.toFixed(2)} km left · +${Math.round(this.route.totalAscentM)} m`;

    if (upcomingCue) {
      this._els.cue.textContent = upcomingCue;
      this._els.cue.classList.remove('hidden');
    } else {
      this._els.cue.classList.add('hidden');
    }

    if (ghostEnabled) {
      const gLoop = ((ghostDistanceM % totalM) + totalM) % totalM;
      const gx = (gLoop / totalM) * W;
      const gEle = ghostEleM ?? minE;
      const gy = padTop + (1 - (gEle - minE) / spanE) * usableH;
      this._els.ghost.setAttribute('cx', gx.toFixed(1));
      this._els.ghost.setAttribute('cy', gy.toFixed(1));
      this._els.ghost.classList.remove('hidden');
    } else {
      this._els.ghost.classList.add('hidden');
    }
  }

  clear() {
    this.route = null;
    this._els = null;
    this.container.innerHTML = '';
    this.container.classList.add('hidden');
  }

  _escape(str) {
    return String(str).replace(/[&<>"']/g, (ch) => {
      switch (ch) {
        case '&':
          return '&amp;';
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '"':
          return '&quot;';
        default:
          return '&#39;';
      }
    });
  }
}
