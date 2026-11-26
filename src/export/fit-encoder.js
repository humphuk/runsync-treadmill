/**
 * Zero-dependency Garmin .FIT (Protocol 2.0) binary activity & HRV encoder,
 * plus RunRecorder for buffered treadmill runs with 1 km auto-laps and
 * post-run treadmill console distance reconciliation.
 */

export const FIT_EPOCH_MS = Date.UTC(1989, 11, 31, 0, 0, 0);
export const FIT_SPORT_RUNNING = 1;
export const FIT_SUB_SPORT_TREADMILL = 1;

const FIT_CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401,
  0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400,
];

const FIT_BASE_TYPES = Object.freeze({
  ENUM: 0x00,
  SINT8: 0x01,
  UINT8: 0x02,
  SINT16: 0x83,
  UINT16: 0x84,
  SINT32: 0x85,
  UINT32: 0x86,
  UINT32Z: 0x8c,
});

const MESG_DEFS = Object.freeze({
  file_id: {
    localType: 0,
    globalNum: 0,
    fields: [
      [0, 1, FIT_BASE_TYPES.ENUM],    // type (4 = activity)
      [1, 2, FIT_BASE_TYPES.UINT16],  // manufacturer
      [2, 2, FIT_BASE_TYPES.UINT16],  // product
      [3, 4, FIT_BASE_TYPES.UINT32Z], // serial_number
      [4, 4, FIT_BASE_TYPES.UINT32],  // time_created
    ],
  },
  event: {
    localType: 1,
    globalNum: 21,
    fields: [
      [253, 4, FIT_BASE_TYPES.UINT32], // timestamp
      [0, 1, FIT_BASE_TYPES.ENUM],     // event (0 = timer)
      [1, 1, FIT_BASE_TYPES.ENUM],     // event_type (0 = start, 1 = stop, 4 = stop_all)
      [4, 1, FIT_BASE_TYPES.UINT8],    // event_group
    ],
  },
  record: {
    localType: 2,
    globalNum: 20,
    fields: [
      [253, 4, FIT_BASE_TYPES.UINT32], // timestamp
      [5, 4, FIT_BASE_TYPES.UINT32],   // distance (cm)
      [6, 2, FIT_BASE_TYPES.UINT16],   // speed (mm/s)
      [7, 2, FIT_BASE_TYPES.UINT16],   // power (W)
      [4, 1, FIT_BASE_TYPES.UINT8],    // cadence (strides/min for running)
      [3, 1, FIT_BASE_TYPES.UINT8],    // heart_rate (bpm)
      [2, 2, FIT_BASE_TYPES.UINT16],   // altitude ((m + 500) * 5)
      [9, 2, FIT_BASE_TYPES.SINT16],   // grade (pct * 100)
    ],
  },
  hrv: {
    localType: 3,
    globalNum: 78,
    fields: [
      [0, 10, FIT_BASE_TYPES.UINT16],  // time[5] (ms, 0xFFFF invalid)
    ],
  },
  lap: {
    localType: 4,
    globalNum: 19,
    fields: [
      [253, 4, FIT_BASE_TYPES.UINT32], // timestamp
      [2, 4, FIT_BASE_TYPES.UINT32],   // start_time
      [7, 4, FIT_BASE_TYPES.UINT32],   // total_elapsed_time (ms)
      [8, 4, FIT_BASE_TYPES.UINT32],   // total_timer_time (ms)
      [9, 4, FIT_BASE_TYPES.UINT32],   // total_distance (cm)
      [15, 1, FIT_BASE_TYPES.UINT8],   // avg_heart_rate
      [16, 1, FIT_BASE_TYPES.UINT8],   // max_heart_rate
      [17, 1, FIT_BASE_TYPES.UINT8],   // avg_cadence
      [19, 2, FIT_BASE_TYPES.UINT16],  // avg_power
      [20, 2, FIT_BASE_TYPES.UINT16],  // max_power
      [24, 1, FIT_BASE_TYPES.ENUM],    // lap_trigger
      [25, 1, FIT_BASE_TYPES.ENUM],    // sport
    ],
  },
  session: {
    localType: 5,
    globalNum: 18,
    fields: [
      [253, 4, FIT_BASE_TYPES.UINT32], // timestamp
      [2, 4, FIT_BASE_TYPES.UINT32],   // start_time
      [5, 1, FIT_BASE_TYPES.ENUM],     // sport
      [6, 1, FIT_BASE_TYPES.ENUM],     // sub_sport
      [7, 4, FIT_BASE_TYPES.UINT32],   // total_elapsed_time (ms)
      [8, 4, FIT_BASE_TYPES.UINT32],   // total_timer_time (ms)
      [9, 4, FIT_BASE_TYPES.UINT32],   // total_distance (cm)
      [16, 1, FIT_BASE_TYPES.UINT8],   // avg_heart_rate
      [17, 1, FIT_BASE_TYPES.UINT8],   // max_heart_rate
      [18, 1, FIT_BASE_TYPES.UINT8],   // avg_cadence
      [20, 2, FIT_BASE_TYPES.UINT16],  // avg_power
      [21, 2, FIT_BASE_TYPES.UINT16],  // max_power
      [25, 2, FIT_BASE_TYPES.UINT16],  // first_lap_index
      [26, 2, FIT_BASE_TYPES.UINT16],  // num_laps
    ],
  },
  activity: {
    localType: 6,
    globalNum: 34,
    fields: [
      [253, 4, FIT_BASE_TYPES.UINT32], // timestamp
      [0, 4, FIT_BASE_TYPES.UINT32],   // total_timer_time (ms)
      [1, 2, FIT_BASE_TYPES.UINT16],   // num_sessions
      [2, 1, FIT_BASE_TYPES.ENUM],     // type (0 = manual)
      [3, 1, FIT_BASE_TYPES.ENUM],     // event (26 = activity)
      [4, 1, FIT_BASE_TYPES.ENUM],     // event_type (1 = stop)
    ],
  },
});

/**
 * Compute official Garmin FIT CRC-16 checksum over a byte range.
 * @param {Uint8Array} bytes
 * @param {number} [start=0]
 * @param {number} [end=bytes.length]
 * @returns {number}
 */
export function fitCrc16(bytes, start = 0, end = bytes.length) {
  let crc = 0;
  for (let i = start; i < end; i += 1) {
    const byte = bytes[i];
    let tmp = FIT_CRC_TABLE[crc & 0x0f];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ FIT_CRC_TABLE[byte & 0x0f];
    tmp = FIT_CRC_TABLE[crc & 0x0f];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ FIT_CRC_TABLE[(byte >> 4) & 0x0f];
  }
  return crc & 0xffff;
}

/**
 * Convert a Date or Unix epoch milliseconds to FIT timestamp seconds (since 1989-12-31T00:00:00Z).
 * @param {Date | number} dateOrMs
 * @returns {number}
 */
export function toFitTimestamp(dateOrMs) {
  const ms = dateOrMs instanceof Date ? dateOrMs.getTime() : Number(dateOrMs);
  return Math.max(0, Math.round((ms - FIT_EPOCH_MS) / 1000)) >>> 0;
}

function clampInt(val, min, max) {
  return Math.min(max, Math.max(min, Math.round(val)));
}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function createStatsAccumulator(startTimeMs) {
  return {
    startTimeMs,
    lastTimeMs: startTimeMs,
    maxDistanceM: 0,
    powerSum: 0,
    powerCount: 0,
    maxPowerW: 0,
    hrSum: 0,
    hrCount: 0,
    maxHr: 0,
    cadenceSum: 0,
    cadenceCount: 0,
  };
}

function updateStats(acc, { timestampMs, distanceM, powerW, heartRateBpm, cadenceRpm }) {
  if (typeof timestampMs === 'number' && Number.isFinite(timestampMs)) {
    acc.lastTimeMs = Math.max(acc.lastTimeMs, timestampMs);
  }
  if (typeof distanceM === 'number' && Number.isFinite(distanceM)) {
    acc.maxDistanceM = Math.max(acc.maxDistanceM, distanceM);
  }
  if (typeof powerW === 'number' && Number.isFinite(powerW) && powerW >= 0) {
    acc.powerSum += powerW;
    acc.powerCount += 1;
    acc.maxPowerW = Math.max(acc.maxPowerW, powerW);
  }
  if (typeof heartRateBpm === 'number' && Number.isFinite(heartRateBpm) && heartRateBpm > 0) {
    acc.hrSum += heartRateBpm;
    acc.hrCount += 1;
    acc.maxHr = Math.max(acc.maxHr, heartRateBpm);
  }
  if (typeof cadenceRpm === 'number' && Number.isFinite(cadenceRpm) && cadenceRpm >= 0) {
    acc.cadenceSum += cadenceRpm;
    acc.cadenceCount += 1;
  }
}

/**
 * Stateful .FIT activity encoder supporting 1 Hz records, HRV RR intervals, laps, and session summaries.
 */
export class FitEncoder {
  /**
   * @param {{
   *   startTimeMs?: number,
   *   manufacturer?: number,
   *   product?: number,
   *   serialNumber?: number,
   *   sport?: number,
   *   subSport?: number,
   * }} [options]
   */
  constructor({
    startTimeMs = Date.now(),
    manufacturer = 255,
    product = 1,
    serialNumber = 123456,
    sport = FIT_SPORT_RUNNING,
    subSport = FIT_SUB_SPORT_TREADMILL,
  } = {}) {
    this.startTimeMs = startTimeMs;
    this.sport = sport;
    this.subSport = subSport;
    this._chunks = [];
    this._definedLocals = new Set();
    this._lapCount = 0;
    this._sessionStats = createStatsAccumulator(startTimeMs);
    this._lapStats = createStatsAccumulator(startTimeMs);
    this._lapStartDistanceM = 0;

    this._writeDataMessage(MESG_DEFS.file_id, (w) => {
      w.uint8(4); // file type = activity
      w.uint16(manufacturer);
      w.uint16(product);
      w.uint32(serialNumber);
      w.uint32(toFitTimestamp(startTimeMs));
    });

    this.addEvent({ timestampMs: startTimeMs, event: 0, eventType: 0 }); // timer start
  }

  _writeBytes(bytes) {
    this._chunks.push(bytes);
  }

  _ensureDefinition(def) {
    if (this._definedLocals.has(def.localType)) {
      return;
    }
    this._definedLocals.add(def.localType);
    const len = 6 + def.fields.length * 3;
    const buf = new Uint8Array(len);
    const view = new DataView(buf.buffer);
    buf[0] = 0x40 | (def.localType & 0x0f);
    buf[1] = 0x00; // reserved
    buf[2] = 0x00; // little-endian
    view.setUint16(3, def.globalNum, true);
    buf[5] = def.fields.length;
    let offset = 6;
    for (const [fieldNum, size, baseType] of def.fields) {
      buf[offset] = fieldNum;
      buf[offset + 1] = size;
      buf[offset + 2] = baseType;
      offset += 3;
    }
    this._writeBytes(buf);
  }

  _writeDataMessage(def, fillFn) {
    this._ensureDefinition(def);
    const payloadSize = def.fields.reduce((sum, f) => sum + f[1], 0);
    const buf = new Uint8Array(1 + payloadSize);
    const view = new DataView(buf.buffer);
    buf[0] = def.localType & 0x0f;
    let pos = 1;
    const writer = {
      uint8: (v) => {
        view.setUint8(pos, v);
        pos += 1;
      },
      uint16: (v) => {
        view.setUint16(pos, v, true);
        pos += 2;
      },
      sint16: (v) => {
        view.setInt16(pos, v, true);
        pos += 2;
      },
      uint32: (v) => {
        view.setUint32(pos, v >>> 0, true);
        pos += 4;
      },
    };
    fillFn(writer);
    this._writeBytes(buf);
  }

  /**
   * Record a timer or activity event.
   * @param {{ timestampMs?: number, event?: number, eventType?: number, eventGroup?: number }} [opts]
   */
  addEvent({ timestampMs = Date.now(), event = 0, eventType = 0, eventGroup = 0 } = {}) {
    this._writeDataMessage(MESG_DEFS.event, (w) => {
      w.uint32(toFitTimestamp(timestampMs));
      w.uint8(event);
      w.uint8(eventType);
      w.uint8(eventGroup);
    });
  }

  /**
   * Append a 1 Hz sample record.
   * @param {{
   *   timestampMs?: number,
   *   distanceM?: number | null,
   *   speedMps?: number | null,
   *   powerW?: number | null,
   *   cadenceRpm?: number | null,
   *   heartRateBpm?: number | null,
   *   altitudeM?: number | null,
   *   gradePct?: number | null,
   * }} sample
   */
  addRecord(sample = {}) {
    const {
      timestampMs = Date.now(),
      distanceM = null,
      speedMps = null,
      powerW = null,
      cadenceRpm = null,
      heartRateBpm = null,
      altitudeM = null,
      gradePct = null,
    } = sample;

    updateStats(this._sessionStats, { timestampMs, distanceM, powerW, heartRateBpm, cadenceRpm });
    updateStats(this._lapStats, { timestampMs, distanceM, powerW, heartRateBpm, cadenceRpm });

    this._writeDataMessage(MESG_DEFS.record, (w) => {
      w.uint32(toFitTimestamp(timestampMs));
      w.uint32(
        typeof distanceM === 'number' && Number.isFinite(distanceM)
          ? clampInt(distanceM * 100, 0, 0xfffffffe)
          : 0xffffffff,
      );
      w.uint16(
        typeof speedMps === 'number' && Number.isFinite(speedMps)
          ? clampInt(speedMps * 1000, 0, 0xfffe)
          : 0xffff,
      );
      w.uint16(
        typeof powerW === 'number' && Number.isFinite(powerW)
          ? clampInt(powerW, 0, 0xfffe)
          : 0xffff,
      );
      w.uint8(
        typeof cadenceRpm === 'number' && Number.isFinite(cadenceRpm)
          ? clampInt(cadenceRpm, 0, 0xfe)
          : 0xff,
      );
      w.uint8(
        typeof heartRateBpm === 'number' && Number.isFinite(heartRateBpm)
          ? clampInt(heartRateBpm, 0, 0xfe)
          : 0xff,
      );
      w.uint16(
        typeof altitudeM === 'number' && Number.isFinite(altitudeM)
          ? clampInt((altitudeM + 500) * 5, 0, 0xfffe)
          : 0xffff,
      );
      w.sint16(
        typeof gradePct === 'number' && Number.isFinite(gradePct)
          ? clampInt(gradePct * 100, -32768, 32766)
          : 0x7fff,
      );
    });
  }

  /**
   * Append HRV RR intervals in milliseconds (encoded as FIT hrv time[5] arrays).
   * @param {number[]} rrIntervalsMs
   */
  addHrv(rrIntervalsMs) {
    if (!Array.isArray(rrIntervalsMs) || rrIntervalsMs.length === 0) {
      return;
    }
    const valid = rrIntervalsMs.filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
    for (let i = 0; i < valid.length; i += 5) {
      this._writeDataMessage(MESG_DEFS.hrv, (w) => {
        for (let slot = 0; slot < 5; slot += 1) {
          const val = valid[i + slot];
          w.uint16(val !== undefined ? clampInt(val, 1, 0xfffe) : 0xffff);
        }
      });
    }
  }

  /**
   * Close the current lap (computes defaults from accumulated records when omitted).
   * @param {{
   *   startTimeMs?: number,
   *   endTimeMs?: number,
   *   distanceM?: number,
   *   avgPowerW?: number,
   *   maxPowerW?: number,
   *   avgHr?: number,
   *   maxHr?: number,
   *   avgCadence?: number,
   *   lapTrigger?: number,
   * }} [opts]
   */
  addLap(opts = {}) {
    const startMs = opts.startTimeMs ?? this._lapStats.startTimeMs;
    const endMs = opts.endTimeMs ?? Math.max(startMs, this._lapStats.lastTimeMs);
    const elapsedMs = Math.max(0, Math.round(endMs - startMs));
    const lapDistanceM =
      opts.distanceM ?? Math.max(0, this._lapStats.maxDistanceM - this._lapStartDistanceM);
    const avgHr =
      opts.avgHr ??
      (this._lapStats.hrCount > 0 ? Math.round(this._lapStats.hrSum / this._lapStats.hrCount) : 0xff);
    const maxHr = opts.maxHr ?? (this._lapStats.hrCount > 0 ? Math.round(this._lapStats.maxHr) : 0xff);
    const avgCad =
      opts.avgCadence ??
      (this._lapStats.cadenceCount > 0
        ? Math.round(this._lapStats.cadenceSum / this._lapStats.cadenceCount)
        : 0xff);
    const avgPower =
      opts.avgPowerW ??
      (this._lapStats.powerCount > 0
        ? Math.round(this._lapStats.powerSum / this._lapStats.powerCount)
        : 0xffff);
    const maxPower =
      opts.maxPowerW ?? (this._lapStats.powerCount > 0 ? Math.round(this._lapStats.maxPowerW) : 0xffff);

    this._writeDataMessage(MESG_DEFS.lap, (w) => {
      w.uint32(toFitTimestamp(endMs));
      w.uint32(toFitTimestamp(startMs));
      w.uint32(elapsedMs);
      w.uint32(elapsedMs);
      w.uint32(clampInt(lapDistanceM * 100, 0, 0xfffffffe));
      w.uint8(clampInt(avgHr, 0, 0xff));
      w.uint8(clampInt(maxHr, 0, 0xff));
      w.uint8(clampInt(avgCad, 0, 0xff));
      w.uint16(clampInt(avgPower, 0, 0xffff));
      w.uint16(clampInt(maxPower, 0, 0xffff));
      w.uint8(opts.lapTrigger ?? 0);
      w.uint8(this.sport);
    });

    this._lapCount += 1;
    this._lapStartDistanceM = this._sessionStats.maxDistanceM;
    this._lapStats = createStatsAccumulator(endMs);
  }

  /**
   * Finalize the activity file and return a complete FIT binary buffer.
   * @param {{ endTimeMs?: number }} [opts]
   * @returns {Uint8Array}
   */
  finish({ endTimeMs } = {}) {
    const finalMs = endTimeMs ?? Math.max(this.startTimeMs, this._sessionStats.lastTimeMs);
    this.addEvent({ timestampMs: finalMs, event: 0, eventType: 4 }); // timer stop_all

    if (this._lapCount === 0 || this._lapStats.lastTimeMs > this._lapStats.startTimeMs) {
      this.addLap({ endTimeMs: finalMs, lapTrigger: 7 });
    }

    const totalMs = Math.max(0, Math.round(finalMs - this.startTimeMs));
    const avgHr =
      this._sessionStats.hrCount > 0
        ? Math.round(this._sessionStats.hrSum / this._sessionStats.hrCount)
        : 0xff;
    const maxHr = this._sessionStats.hrCount > 0 ? Math.round(this._sessionStats.maxHr) : 0xff;
    const avgCad =
      this._sessionStats.cadenceCount > 0
        ? Math.round(this._sessionStats.cadenceSum / this._sessionStats.cadenceCount)
        : 0xff;
    const avgPower =
      this._sessionStats.powerCount > 0
        ? Math.round(this._sessionStats.powerSum / this._sessionStats.powerCount)
        : 0xffff;
    const maxPower =
      this._sessionStats.powerCount > 0 ? Math.round(this._sessionStats.maxPowerW) : 0xffff;

    this._writeDataMessage(MESG_DEFS.session, (w) => {
      w.uint32(toFitTimestamp(finalMs));
      w.uint32(toFitTimestamp(this.startTimeMs));
      w.uint8(this.sport);
      w.uint8(this.subSport);
      w.uint32(totalMs);
      w.uint32(totalMs);
      w.uint32(clampInt(this._sessionStats.maxDistanceM * 100, 0, 0xfffffffe));
      w.uint8(clampInt(avgHr, 0, 0xff));
      w.uint8(clampInt(maxHr, 0, 0xff));
      w.uint8(clampInt(avgCad, 0, 0xff));
      w.uint16(clampInt(avgPower, 0, 0xffff));
      w.uint16(clampInt(maxPower, 0, 0xffff));
      w.uint16(0); // first_lap_index
      w.uint16(this._lapCount);
    });

    this._writeDataMessage(MESG_DEFS.activity, (w) => {
      w.uint32(toFitTimestamp(finalMs));
      w.uint32(totalMs);
      w.uint16(1); // num_sessions
      w.uint8(0);  // manual
      w.uint8(26); // activity
      w.uint8(1);  // stop
    });

    const dataSize = this._chunks.reduce((sum, c) => sum + c.length, 0);
    const fileBytes = new Uint8Array(14 + dataSize + 2);
    const view = new DataView(fileBytes.buffer);

    // 14-byte FIT file header
    fileBytes[0] = 14;
    fileBytes[1] = 0x20; // Protocol 2.0
    view.setUint16(2, 2140, true); // Profile 21.40
    view.setUint32(4, dataSize, true);
    fileBytes[8] = 0x2e; // '.'
    fileBytes[9] = 0x46; // 'F'
    fileBytes[10] = 0x49; // 'I'
    fileBytes[11] = 0x54; // 'T'
    view.setUint16(12, fitCrc16(fileBytes, 0, 12), true);

    let offset = 14;
    for (const chunk of this._chunks) {
      fileBytes.set(chunk, offset);
      offset += chunk.length;
    }

    const fileCrc = fitCrc16(fileBytes, 0, 14 + dataSize);
    view.setUint16(14 + dataSize, fileCrc, true);
    return fileBytes;
  }

  /**
   * Convenience helper returning a downloadable `.fit` Blob.
   * @param {{ endTimeMs?: number }} [opts]
   * @returns {Blob}
   */
  toBlob(opts = {}) {
    return new Blob([this.finish(opts)], { type: 'application/octet-stream' });
  }
}

/**
 * Buffers 1 Hz treadmill running telemetry and HRV RR intervals during a run,
 * then builds a Running/Treadmill .FIT file with 1 km auto-laps and optional
 * post-run distance reconciliation against the treadmill console display.
 */
export class RunRecorder {
  constructor({ startTimeMs = Date.now(), autoLapDistanceM = 1000 } = {}) {
    this.startTimeMs = startTimeMs;
    this.autoLapDistanceM = autoLapDistanceM;
    this._samples = [];
    this._hrvEntries = [];
    this._maxDistanceM = 0;
  }

  reset(startTimeMs = Date.now()) {
    this.startTimeMs = startTimeMs;
    this._samples = [];
    this._hrvEntries = [];
    this._maxDistanceM = 0;
  }

  get sampleCount() {
    return this._samples.length;
  }

  get recordedDistanceM() {
    return this._maxDistanceM;
  }

  /**
   * Add a 1 Hz sample.
   * @param {{
   *   timestampMs?: number,
   *   distanceM?: number,
   *   speedMps?: number,
   *   cadenceSpm?: number | null,
   *   heartRateBpm?: number | null,
   *   altitudeM?: number,
   *   gradePct?: number,
   * }} sample
   */
  addSample(sample = {}) {
    const timestampMs = sample.timestampMs ?? Date.now();
    const distanceM =
      typeof sample.distanceM === 'number' && Number.isFinite(sample.distanceM)
        ? Math.max(this._maxDistanceM, sample.distanceM)
        : this._maxDistanceM;
    this._maxDistanceM = distanceM;

    this._samples.push({
      timestampMs,
      distanceM,
      speedMps:
        typeof sample.speedMps === 'number' && Number.isFinite(sample.speedMps)
          ? Math.max(0, sample.speedMps)
          : 0,
      cadenceSpm:
        typeof sample.cadenceSpm === 'number' && Number.isFinite(sample.cadenceSpm)
          ? sample.cadenceSpm
          : null,
      heartRateBpm:
        typeof sample.heartRateBpm === 'number' && Number.isFinite(sample.heartRateBpm)
          ? sample.heartRateBpm
          : null,
      altitudeM:
        typeof sample.altitudeM === 'number' && Number.isFinite(sample.altitudeM)
          ? sample.altitudeM
          : 0,
      gradePct:
        typeof sample.gradePct === 'number' && Number.isFinite(sample.gradePct)
          ? sample.gradePct
          : 0,
    });
  }

  /**
   * Buffer RR intervals in milliseconds.
   * @param {number[]} rrIntervalsMs
   */
  addHrv(rrIntervalsMs) {
    if (!Array.isArray(rrIntervalsMs) || rrIntervalsMs.length === 0) {
      return;
    }
    const valid = rrIntervalsMs.filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
    if (valid.length > 0) {
      this._hrvEntries.push(valid);
    }
  }

  /**
   * Build the final Running/Treadmill .FIT binary and summary statistics.
   * @param {{ actualDistanceKm?: number | null, endTimeMs?: number }} [opts]
   * @returns {{
   *   bytes: Uint8Array,
   *   scaleFactor: number,
   *   summary: {
   *     elapsedSec: number,
   *     distanceKm: number,
   *     avgSpeedKph: number,
   *     avgHr: number | null,
   *     maxHr: number | null,
   *     elevationGainM: number,
   *     laps: number,
   *   }
   * }}
   */
  buildFit({ actualDistanceKm = null, endTimeMs } = {}) {
    const recordedDistanceM = this._maxDistanceM;
    const hasActual =
      typeof actualDistanceKm === 'number' &&
      Number.isFinite(actualDistanceKm) &&
      actualDistanceKm > 0 &&
      recordedDistanceM > 10;

    const scaleFactor = hasActual
      ? clamp((actualDistanceKm * 1000) / recordedDistanceM, 0.5, 2.0)
      : 1.0;

    const fit = new FitEncoder({
      startTimeMs: this.startTimeMs,
      sport: FIT_SPORT_RUNNING,
      subSport: FIT_SUB_SPORT_TREADMILL,
    });

    let nextLapThresholdM = this.autoLapDistanceM;
    let hrSum = 0;
    let hrCount = 0;
    let maxHr = 0;
    let maxAltitudeM = 0;

    for (const s of this._samples) {
      const scaledDistanceM = s.distanceM * scaleFactor;
      const scaledSpeedMps = s.speedMps * scaleFactor;
      const scaledAltitudeM = s.altitudeM * scaleFactor;
      // Garmin FIT running cadence expects single-foot strides/min (~85-95 for 170-190 spm).
      const cadenceStrideRpm =
        s.cadenceSpm !== null && s.cadenceSpm >= 0 ? Math.round(s.cadenceSpm / 2) : null;

      if (s.heartRateBpm !== null && s.heartRateBpm > 0) {
        hrSum += s.heartRateBpm;
        hrCount += 1;
        maxHr = Math.max(maxHr, s.heartRateBpm);
      }
      maxAltitudeM = Math.max(maxAltitudeM, scaledAltitudeM);

      fit.addRecord({
        timestampMs: s.timestampMs,
        distanceM: scaledDistanceM,
        speedMps: scaledSpeedMps,
        powerW: null,
        cadenceRpm: cadenceStrideRpm,
        heartRateBpm: s.heartRateBpm,
        altitudeM: scaledAltitudeM,
        gradePct: s.gradePct,
      });

      while (this.autoLapDistanceM > 0 && scaledDistanceM >= nextLapThresholdM) {
        fit.addLap({ endTimeMs: s.timestampMs, lapTrigger: 2 });
        nextLapThresholdM += this.autoLapDistanceM;
      }
    }

    for (const rr of this._hrvEntries) {
      fit.addHrv(rr);
    }

    const lastSampleMs =
      this._samples.length > 0 ? this._samples[this._samples.length - 1].timestampMs : this.startTimeMs;
    const finalEndMs = endTimeMs ?? Math.max(this.startTimeMs, lastSampleMs);
    const bytes = fit.finish({ endTimeMs: finalEndMs });

    const elapsedSec = Math.max(0, Math.round((finalEndMs - this.startTimeMs) / 1000));
    const distanceKm = (recordedDistanceM * scaleFactor) / 1000;
    const avgSpeedKph = elapsedSec > 0 ? distanceKm / (elapsedSec / 3600) : 0;

    return {
      bytes,
      scaleFactor,
      summary: {
        elapsedSec,
        distanceKm,
        avgSpeedKph,
        avgHr: hrCount > 0 ? Math.round(hrSum / hrCount) : null,
        maxHr: hrCount > 0 ? Math.round(maxHr) : null,
        elevationGainM: Math.round(maxAltitudeM * 10) / 10,
        laps: fit._lapCount,
      },
    };
  }
}
