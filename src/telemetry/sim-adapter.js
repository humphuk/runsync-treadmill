/**
 * Desk Simulator adapter for testing video speed sync, HR zones, auto-pause,
 * and .FIT recording without stepping onto the treadmill.
 */

const DEMO_SEGMENTS = [
  { durationSec: 12, speedKph: 6.5, inclinePct: 0.0, hrBpm: 122, cadenceSpm: 158 },
  { durationSec: 18, speedKph: 9.8, inclinePct: 1.5, hrBpm: 146, cadenceSpm: 172 },
  { durationSec: 18, speedKph: 12.6, inclinePct: 3.0, hrBpm: 168, cadenceSpm: 184 },
  { durationSec: 14, speedKph: 7.4, inclinePct: 0.5, hrBpm: 138, cadenceSpm: 162 },
  { durationSec: 6, speedKph: 0.0, inclinePct: 0.0, hrBpm: 112, cadenceSpm: 0 },
];

export class SimAdapter extends EventTarget {
  constructor() {
    super();
    this.active = false;
    this.intervalDemo = false;
    this.speedKph = 9.5;
    this.inclinePct = 1.0;
    this.hrBpm = 142;
    this._timer = null;
    this._demoElapsedSec = 0;
  }

  start() {
    if (this.active) {
      return;
    }
    this.active = true;
    this._emitSample();
    this._timer = setInterval(() => {
      if (this.intervalDemo) {
        this._advanceDemo(0.25);
      }
      this._emitSample();
    }, 250);
    this.dispatchEvent(new CustomEvent('status', { detail: { active: true } }));
  }

  stop() {
    if (!this.active) {
      return;
    }
    this.active = false;
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this.dispatchEvent(new CustomEvent('status', { detail: { active: false } }));
  }

  setValues({ speedKph, inclinePct, hrBpm }) {
    if (typeof speedKph === 'number' && Number.isFinite(speedKph)) {
      this.speedKph = speedKph;
    }
    if (typeof inclinePct === 'number' && Number.isFinite(inclinePct)) {
      this.inclinePct = inclinePct;
    }
    if (typeof hrBpm === 'number' && Number.isFinite(hrBpm)) {
      this.hrBpm = hrBpm;
    }
    if (this.active) {
      this._emitSample();
    }
  }

  setIntervalDemo(enabled) {
    this.intervalDemo = Boolean(enabled);
    if (this.intervalDemo) {
      this._demoElapsedSec = 0;
      this._advanceDemo(0);
    }
  }

  _advanceDemo(dtSec) {
    const totalCycle = DEMO_SEGMENTS.reduce((sum, seg) => sum + seg.durationSec, 0);
    this._demoElapsedSec = (this._demoElapsedSec + dtSec) % totalCycle;

    let acc = 0;
    let current = DEMO_SEGMENTS[0];
    for (const seg of DEMO_SEGMENTS) {
      if (this._demoElapsedSec < acc + seg.durationSec) {
        current = seg;
        break;
      }
      acc += seg.durationSec;
    }

    this.speedKph = current.speedKph;
    this.inclinePct = current.inclinePct;
    this.hrBpm = current.hrBpm;
  }

  _emitSample() {
    const speedMps = Math.max(0, this.speedKph) / 3.6;
    const cadenceSpm =
      this.speedKph < 0.5
        ? 0
        : Math.round(145 + (this.speedKph - 5) * 4.8 + Math.sin(Date.now() / 1200) * 1.5);

    this.dispatchEvent(
      new CustomEvent('speed', {
        detail: {
          speedMps,
          speedKph: this.speedKph,
          cadenceSpm,
          inclinePct: this.inclinePct,
        },
      }),
    );

    const hrJitter = Math.round(Math.sin(Date.now() / 1800) * 1.5);
    const bpm = Math.max(50, Math.round(this.hrBpm + hrJitter));
    const rrMs = Math.round((60 / bpm) * 1000);
    this.dispatchEvent(
      new CustomEvent('hr', {
        detail: {
          bpm,
          rrIntervalsMs: [rrMs],
        },
      }),
    );
  }
}
