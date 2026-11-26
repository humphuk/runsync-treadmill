/**
 * Web Bluetooth Heart Rate Service (0x180D / 0x2A37) client with RR-interval decoding.
 */

export const HR_SERVICE_UUID = 0x180d;
export const HR_MEASUREMENT_UUID = 0x2a37;

function toDataView(input) {
  if (input instanceof DataView) {
    return input;
  }
  if (ArrayBuffer.isView(input)) {
    return new DataView(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof ArrayBuffer) {
    return new DataView(input);
  }
  const bytes = Uint8Array.from(input);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Parse BLE Heart Rate Measurement (0x2A37) notification payload.
 * Decodes 8-bit/16-bit BPM, contact detection, energy expended, and RR intervals (1/1024s -> ms).
 *
 * @param {DataView | Uint8Array | ArrayBuffer} input
 * @returns {{
 *   bpm: number,
 *   contactDetected: boolean | null,
 *   energyExpendedKj: number | null,
 *   rrIntervalsMs: number[],
 * }}
 */
export function parseHeartRateMeasurement(input) {
  const view = toDataView(input);
  if (view.byteLength < 2) {
    throw new Error('Heart Rate Measurement payload must be at least 2 bytes');
  }

  const flags = view.getUint8(0);
  let offset = 1;

  // Bit 0: 0 -> uint8 BPM, 1 -> uint16 BPM
  const isUint16 = (flags & 0x01) !== 0;
  let bpm = 0;
  if (isUint16) {
    if (offset + 2 > view.byteLength) {
      throw new Error('Truncated 16-bit Heart Rate Measurement');
    }
    bpm = view.getUint16(offset, true);
    offset += 2;
  } else {
    bpm = view.getUint8(offset);
    offset += 1;
  }

  // Bits 1-2: Sensor Contact Status
  const contactSupported = (flags & 0x04) !== 0;
  const contactDetected = contactSupported ? (flags & 0x02) !== 0 : null;

  // Bit 3: Energy Expended present (uint16 kJ)
  let energyExpendedKj = null;
  if ((flags & 0x08) !== 0 && offset + 2 <= view.byteLength) {
    energyExpendedKj = view.getUint16(offset, true);
    offset += 2;
  }

  // Bit 4: RR-Interval values present (uint16 array in 1/1024s units)
  const rrIntervalsMs = [];
  if ((flags & 0x10) !== 0) {
    while (offset + 2 <= view.byteLength) {
      const rawRr = view.getUint16(offset, true);
      offset += 2;
      rrIntervalsMs.push((rawRr / 1024) * 1000);
    }
  }

  return {
    bpm,
    contactDetected,
    energyExpendedKj,
    rrIntervalsMs,
  };
}

/**
 * Web Bluetooth Heart Rate Strap client emitting `'hr'` events with RR intervals.
 */
export class HeartRateClient extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.server = null;
    this.hrChar = null;
    this.batteryLevel = null;
    this._isConnecting = false;
    this._userInitiatedDisconnect = false;
    this._reconnectAttempts = 0;
    this._reconnectTimer = null;
    this._batteryTimer = null;
    this._gattQueue = Promise.resolve();

    this._onDisconnected = this._handleDisconnected.bind(this);
    this._onHrValueChanged = this._handleHrValueChanged.bind(this);
  }

  get isConnected() {
    return Boolean(this.server && this.server.connected);
  }

  _enqueueGatt(fn) {
    const next = this._gattQueue.then(fn, fn);
    this._gattQueue = next.catch(() => {});
    return next;
  }

  async connect({ acceptAllDevices = false } = {}) {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth is not supported in this browser.');
    }
    this._emitStatus('requesting', 'Select your heart rate monitor...');
    const optionalServices = [HR_SERVICE_UUID, 'battery_service'];
    const requestOptions = acceptAllDevices
      ? { acceptAllDevices: true, optionalServices }
      : { filters: [{ services: [HR_SERVICE_UUID] }], optionalServices };

    const device = await navigator.bluetooth.requestDevice(requestOptions);
    this._userInitiatedDisconnect = false;
    this._reconnectAttempts = 0;
    this.device = device;
    this.device.removeEventListener('gattserverdisconnected', this._onDisconnected);
    this.device.addEventListener('gattserverdisconnected', this._onDisconnected);

    await this._initializeDevice(device);
  }

  async _initializeDevice(device) {
    this._clearTimers();
    this._isConnecting = true;
    try {
      const name = device.name || 'HR Monitor';
      this._emitStatus('connecting', `Connecting to ${name}...`);
      const server = await device.gatt.connect();
      this.server = server;

      const service = await this._enqueueGatt(() => server.getPrimaryService(HR_SERVICE_UUID));
      this.hrChar = await this._enqueueGatt(() => service.getCharacteristic(HR_MEASUREMENT_UUID));
      this.hrChar.removeEventListener('characteristicvaluechanged', this._onHrValueChanged);
      this.hrChar.addEventListener('characteristicvaluechanged', this._onHrValueChanged);
      await this._enqueueGatt(() => this.hrChar.startNotifications());

      this._batteryTimer = setTimeout(() => {
        if (this.isConnected && this.batteryLevel === null) {
          this._readBatteryLevel().catch(() => {});
        }
      }, 2000);

      this._reconnectAttempts = 0;
      this._emitStatus('connected', `Connected to ${name}`);
    } catch (err) {
      this._isConnecting = false;
      this.dispatchEvent(new CustomEvent('error', { detail: { error: err } }));
      if (this._userInitiatedDisconnect || this._reconnectAttempts === 0) {
        await this.disconnect();
      }
      throw err;
    } finally {
      this._isConnecting = false;
    }
  }

  async disconnect() {
    this._userInitiatedDisconnect = true;
    this._clearTimers();
    if (this.hrChar) {
      this.hrChar.removeEventListener('characteristicvaluechanged', this._onHrValueChanged);
      if (this.isConnected) {
        try {
          await this.hrChar.stopNotifications();
        } catch {
          // Ignore teardown errors.
        }
      }
    }
    const device = this.device;
    if (device) {
      device.removeEventListener('gattserverdisconnected', this._onDisconnected);
      if (device.gatt?.connected) {
        device.gatt.disconnect();
      }
    }
    this._resetState();
    this._emitStatus('disconnected', 'HR monitor disconnected');
  }

  async _readBatteryLevel() {
    try {
      await this._enqueueGatt(async () => {
        if (!this.server?.connected) {
          return;
        }
        const svc = await this.server.getPrimaryService('battery_service');
        const ch = await svc.getCharacteristic('battery_level');
        const view = await ch.readValue();
        this.batteryLevel = view.getUint8(0);
        this.dispatchEvent(new CustomEvent('battery', { detail: { level: this.batteryLevel } }));
      });
    } catch {
      // Optional battery service.
    }
  }

  _handleHrValueChanged(event) {
    const view = event.target?.value;
    if (!view) {
      return;
    }
    try {
      const parsed = parseHeartRateMeasurement(view);
      this.dispatchEvent(new CustomEvent('hr', { detail: parsed }));
    } catch {
      // Ignore malformed HR packets.
    }
  }

  _handleDisconnected() {
    if (this._isConnecting) {
      return;
    }
    this._clearTimers();
    if (!this._userInitiatedDisconnect && this.device && this._reconnectAttempts < 3) {
      this._reconnectAttempts += 1;
      const attempt = this._reconnectAttempts;
      this._emitStatus('connecting', `Reconnecting to HR monitor (${attempt}/3)...`);
      this._reconnectTimer = setTimeout(() => {
        if (!this._userInitiatedDisconnect && this.device) {
          this._initializeDevice(this.device).catch(() => {
            if (this._reconnectAttempts >= 3) {
              this._resetState();
              this._emitStatus('disconnected', 'HR monitor disconnected');
              this.dispatchEvent(new CustomEvent('disconnect'));
            }
          });
        }
      }, 700);
      return;
    }

    this._resetState();
    this._emitStatus('disconnected', 'HR monitor disconnected');
    this.dispatchEvent(new CustomEvent('disconnect'));
  }

  _clearTimers() {
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._batteryTimer !== null) {
      clearTimeout(this._batteryTimer);
      this._batteryTimer = null;
    }
  }

  _resetState() {
    this._clearTimers();
    this.device = null;
    this.server = null;
    this.hrChar = null;
    this.batteryLevel = null;
    this._isConnecting = false;
    this._reconnectAttempts = 0;
  }

  _emitStatus(state, message) {
    this.dispatchEvent(new CustomEvent('status', { detail: { state, message } }));
  }
}
