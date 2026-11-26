/**
 * Web Bluetooth Running Speed and Cadence Service (0x1814 / 0x2A53) client.
 * Compatible with Zwift RunPod and Garmin FR 245 Virtual Run broadcasts.
 */

export const RSC_SERVICE_UUID = 0x1814;
export const RSC_MEASUREMENT_UUID = 0x2a53;
const HR_SERVICE_UUID = 0x180d;

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
 * Parse BLE Running Speed and Cadence Measurement (0x2A53) notification payload.
 *
 * @param {DataView | Uint8Array | ArrayBuffer} input
 * @returns {{
 *   speedMps: number,
 *   speedKph: number,
 *   cadenceStridesPerMin: number,
 *   cadenceSpm: number,
 *   isRunning: boolean,
 *   strideLengthM: number | null,
 *   totalDistanceM: number | null,
 * }}
 */
export function parseRscMeasurement(input) {
  const view = toDataView(input);
  if (view.byteLength < 4) {
    throw new Error('RSC Measurement payload must be at least 4 bytes');
  }

  const flags = view.getUint8(0);
  const rawSpeed = view.getUint16(1, true);
  const speedMps = rawSpeed / 256;
  const speedKph = speedMps * 3.6;

  const cadenceStridesPerMin = view.getUint8(3);
  const cadenceSpm = cadenceStridesPerMin * 2;
  const isRunning = (flags & 0x04) !== 0;

  let offset = 4;
  let strideLengthM = null;
  if ((flags & 0x01) !== 0) {
    if (offset + 2 > view.byteLength) {
      throw new Error('Truncated RSC Instantaneous Stride Length');
    }
    strideLengthM = view.getUint16(offset, true) / 100;
    offset += 2;
  }

  let totalDistanceM = null;
  if ((flags & 0x02) !== 0) {
    if (offset + 4 > view.byteLength) {
      throw new Error('Truncated RSC Total Distance');
    }
    totalDistanceM = view.getUint32(offset, true) / 10;
  }

  return {
    speedMps,
    speedKph,
    cadenceStridesPerMin,
    cadenceSpm,
    isRunning,
    strideLengthM,
    totalDistanceM,
  };
}

/**
 * Web Bluetooth RSC client emitting `'rsc'` events with serialized GATT operations.
 */
export class RscClient extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.server = null;
    this.rscChar = null;
    this.batteryLevel = null;
    this._isConnecting = false;
    this._userInitiatedDisconnect = false;
    this._reconnectAttempts = 0;
    this._reconnectTimer = null;
    this._batteryTimer = null;
    this._gattQueue = Promise.resolve();

    this._onDisconnected = this._handleDisconnected.bind(this);
    this._onValueChanged = this._handleValueChanged.bind(this);
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
    this._emitStatus('requesting', 'Select your Zwift RunPod or Garmin watch...');
    const optionalServices = [RSC_SERVICE_UUID, HR_SERVICE_UUID, 'battery_service'];
    const requestOptions = acceptAllDevices
      ? { acceptAllDevices: true, optionalServices }
      : { filters: [{ services: [RSC_SERVICE_UUID] }], optionalServices };

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
      const name = device.name || 'RunPod';
      this._emitStatus('connecting', `Connecting to ${name}...`);
      const server = await device.gatt.connect();
      this.server = server;

      const service = await this._enqueueGatt(() => server.getPrimaryService(RSC_SERVICE_UUID));
      this.rscChar = await this._enqueueGatt(() => service.getCharacteristic(RSC_MEASUREMENT_UUID));
      this.rscChar.removeEventListener('characteristicvaluechanged', this._onValueChanged);
      this.rscChar.addEventListener('characteristicvaluechanged', this._onValueChanged);
      await this._enqueueGatt(() => this.rscChar.startNotifications());

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
    if (this.rscChar) {
      this.rscChar.removeEventListener('characteristicvaluechanged', this._onValueChanged);
      if (this.isConnected) {
        try {
          await this.rscChar.stopNotifications();
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
    this._emitStatus('disconnected', 'Speed pod disconnected');
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

  _handleValueChanged(event) {
    const view = event.target?.value;
    if (!view) {
      return;
    }
    try {
      const parsed = parseRscMeasurement(view);
      this.dispatchEvent(new CustomEvent('rsc', { detail: parsed }));
    } catch {
      // Ignore malformed RSC packets.
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
      this._emitStatus('connecting', `Reconnecting to speed pod (${attempt}/3)...`);
      this._reconnectTimer = setTimeout(() => {
        if (!this._userInitiatedDisconnect && this.device) {
          this._initializeDevice(this.device).catch(() => {
            if (this._reconnectAttempts >= 3) {
              this._resetState();
              this._emitStatus('disconnected', 'Speed pod disconnected');
              this.dispatchEvent(new CustomEvent('disconnect'));
            }
          });
        }
      }, 700);
      return;
    }

    this._resetState();
    this._emitStatus('disconnected', 'Speed pod disconnected');
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
    this.rscChar = null;
    this.batteryLevel = null;
    this._isConnecting = false;
    this._reconnectAttempts = 0;
  }

  _emitStatus(state, message) {
    this.dispatchEvent(new CustomEvent('status', { detail: { state, message } }));
  }
}
