/**
 * qring.store — Reactive global state for QRing connection (iOS).
 */

import { QRingAdapter } from './QRingAdapter';

export interface QRingDevice {
  deviceId: string;
  name: string;
  mac?: string;
  rssi?: number;
  vendor: string;
  model: string;
  saved?: boolean;
}

export type QRingStatus = 'idle' | 'scanning' | 'connected' | 'syncing' | 'disconnected' | 'error';

export interface QRingState {
  status: QRingStatus;
  devices: QRingDevice[];
  connectedDevice: QRingDevice | null;
  battery: number | null;
  fwVersion: string | null;
  lastSyncAt: string | null;
  syncProgress: string | null;
}

function createInitialState(): QRingState {
  return {
    status: 'idle',
    devices: [],
    connectedDevice: null,
    battery: null,
    fwVersion: null,
    lastSyncAt: null,
    syncProgress: null,
  };
}

class QRingStore {
  private state: QRingState = createInitialState();
  private listeners = new Set<() => void>();
  private adapter = new QRingAdapter();

  constructor() {
    this.adapter.on('onDeviceFound', (device) => {
      if (!this.state.devices.find((d) => d.deviceId === device.deviceId)) {
        this.patch({ devices: [...this.state.devices, device as QRingDevice] });
      }
    });

    this.adapter.on('onConnected', (device) => {
      const diag = this.adapter.getDiagnostics();
      this.patch({
        connectedDevice: device as QRingDevice,
        status: 'connected',
        battery: diag?.battery ?? null,
        fwVersion: diag?.fwVersion ?? null,
      });
    });

    this.adapter.on('onData', (type, samples) => {
      this.patch({ syncProgress: `${type}: ${samples.length} amostras` });
    });

    this.adapter.on('onSyncEnd', () => {
      this.patch({ syncProgress: null });
    });

    this.adapter.on('onError', (code, message) => {
      console.warn('[QRing] Error:', code, message);
      if (this.state.status === 'scanning') {
        this.patch({ status: 'idle' });
      }
    });
  }

  getState(): Readonly<QRingState> { return this.state; }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private patch(partial: Partial<QRingState>) {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((fn) => fn());
  }

  async scan() {
    const available = await this.adapter.isAvailable();
    if (!available) {
      this.patch({ status: 'error' });
      return false;
    }
    this.patch({ devices: [], status: 'scanning' });
    await this.adapter.scan();
    return true;
  }

  async stopScan() {
    await this.adapter.stopScan();
    if (this.state.status === 'scanning') this.patch({ status: 'idle' });
  }

  async connect(deviceId: string): Promise<boolean> {
    const ok = await this.adapter.connect(deviceId);
    if (!ok) this.patch({ status: 'error' });
    return ok;
  }

  async disconnect() {
    await this.adapter.disconnect();
    this.patch({ connectedDevice: null, status: 'disconnected', battery: null, fwVersion: null });
  }

  async sync(options?: { since?: string }) {
    if (!this.state.connectedDevice) return false;
    this.patch({ status: 'syncing', syncProgress: 'Iniciando...' });
    await this.adapter.sync(options);
    this.patch({ status: 'connected', lastSyncAt: new Date().toISOString(), syncProgress: null });
    return true;
  }

  async isAvailable(): Promise<boolean> {
    return this.adapter.isAvailable();
  }
}

export const qringStore = new QRingStore();
