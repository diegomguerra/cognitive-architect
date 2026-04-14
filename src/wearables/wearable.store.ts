/**
 * wearable.store — Minimal QRing-only store for the iOS app.
 * (The Android app has a richer version under src/wearables/jstyle/wearable.store.ts
 *  that multiplexes JStyle X3 + JStyle J5Vital + QRing. Here we only ship
 *  QRing because the iOS app has never integrated J-Style.)
 */

import type {
  WearableDevice,
  WearableStatus,
  BiomarkerType,
  SyncProgress,
  BiomarkerSample,
  DeviceDiagnostics,
} from './jstyle/wearable.types';
import { QRingAdapter } from './qring/QRingAdapter';

const QRING_ENABLED = import.meta.env.VITE_QRING_ENABLED !== 'false';

export interface WearableState {
  status: WearableStatus;
  devices: WearableDevice[];
  connectedDevice: WearableDevice | null;
  syncProgress: Map<BiomarkerType, SyncProgress>;
  pendingSamples: Map<BiomarkerType, BiomarkerSample[]>;
  diagnostics: DeviceDiagnostics | null;
  lastSyncAt: string | null;
}

function createInitialState(): WearableState {
  return {
    status: 'idle',
    devices: [],
    connectedDevice: null,
    syncProgress: new Map(),
    pendingSamples: new Map(),
    diagnostics: null,
    lastSyncAt: null,
  };
}

class WearableStore {
  private state: WearableState = createInitialState();
  private listeners = new Set<() => void>();
  private qring = new QRingAdapter();

  get adapter() { return this.qring; }

  constructor() {
    if (!QRING_ENABLED) return;

    this.qring.on('onDeviceFound', (device) => {
      if (!this.state.devices.find((d) => d.deviceId === device.deviceId)) {
        this.patch({ devices: [...this.state.devices, device] });
      }
    });

    this.qring.on('onConnected', (device) => {
      this.patch({
        connectedDevice: device,
        status: 'connected',
        diagnostics: this.qring.getDiagnostics(),
      });
    });

    this.qring.on('onData', (type, samples) => {
      const existing = this.state.pendingSamples.get(type) ?? [];
      const updated = new Map(this.state.pendingSamples);
      updated.set(type, [...existing, ...samples]);

      const progress = new Map(this.state.syncProgress);
      progress.set(type, { type, status: 'syncing', count: existing.length + samples.length });

      this.patch({ pendingSamples: updated, syncProgress: progress });
    });

    this.qring.on('onSyncEnd', (type) => {
      const progress = new Map(this.state.syncProgress);
      progress.set(type, {
        type,
        status: 'done',
        count: this.state.pendingSamples.get(type)?.length ?? 0,
      });
      this.patch({ syncProgress: progress });
    });

    this.qring.on('onError', (code, message) => {
      console.warn('[wearable] error', code, message);
      this.patch({ status: 'error' });
    });
  }

  getState(): Readonly<WearableState> { return this.state; }
  static isEnabled(): boolean { return QRING_ENABLED; }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private patch(partial: Partial<WearableState>) {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((fn) => fn());
  }

  async scan() {
    this.patch({ devices: [], status: 'scanning' });
    await this.qring.scan();
  }

  async stopScan() {
    await this.qring.stopScan();
    if (this.state.status === 'scanning') this.patch({ status: 'idle' });
  }

  async connect(deviceId: string): Promise<boolean> {
    const ok = await this.qring.connect(deviceId);
    if (!ok) this.patch({ status: 'error' });
    return ok;
  }

  async disconnect() {
    await this.qring.disconnect();
    this.patch({ connectedDevice: null, status: 'disconnected', diagnostics: null });
  }

  async sync(options?: { since?: string }) {
    if (!this.state.connectedDevice) return;
    this.patch({ pendingSamples: new Map(), syncProgress: new Map(), status: 'syncing' });
    await this.qring.sync(options);
    this.patch({ status: 'connected' });
  }

  markFlushed() {
    const now = new Date().toISOString();
    this.patch({ pendingSamples: new Map(), lastSyncAt: now });
  }

  async isAvailable(): Promise<boolean> {
    return this.qring.isAvailable();
  }
}

export const wearableStore = new WearableStore();
