/**
 * wearable.store — Reactive global state for wearable connection.
 * Framework-agnostic; React hook wraps this via useSyncExternalStore pattern.
 */

import type {
  WearableDevice,
  WearableStatus,
  BiomarkerType,
  SyncProgress,
  BiomarkerSample,
  DeviceDiagnostics,
} from './wearable.types';
import { JStyleAdapter } from './JStyleAdapter';
import { wlog } from './wearable.telemetry';

const JSTYLE_ENABLED = import.meta.env.VITE_JSTYLE_ENABLED !== 'false';

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
  readonly adapter = new JStyleAdapter();

  constructor() {
    if (!JSTYLE_ENABLED) return;
    this.wireAdapter();
  }

  private wireAdapter() {
    this.adapter.on('onDeviceFound', (device) => {
      wlog('store', 'deviceFound', device.deviceId);
      if (!this.state.devices.find((d) => d.deviceId === device.deviceId)) {
        this.patch({ devices: [...this.state.devices, device] });
      }
    });

    this.adapter.on('onConnected', (device) => {
      wlog('store', 'connected', device.deviceId);
      this.patch({
        connectedDevice: device,
        status: 'connected',
        diagnostics: this.adapter.getDiagnostics(),
      });
    });

    this.adapter.on('onData', (type, samples) => {
      wlog('store', 'data', type, samples.length);
      const existing = this.state.pendingSamples.get(type) ?? [];
      const updated = new Map(this.state.pendingSamples);
      updated.set(type, [...existing, ...samples]);

      const progress = new Map(this.state.syncProgress);
      progress.set(type, { type, status: 'syncing', count: existing.length + samples.length });

      this.patch({ pendingSamples: updated, syncProgress: progress });
    });

    this.adapter.on('onSyncEnd', (type) => {
      wlog('store', 'syncEnd', type);
      const progress = new Map(this.state.syncProgress);
      progress.set(type, {
        type,
        status: 'done',
        count: this.state.pendingSamples.get(type)?.length ?? 0,
      });
      this.patch({ syncProgress: progress });
    });

    this.adapter.on('onError', (code, message) => {
      wlog('store', 'error', code, message);
      this.patch({ status: 'error' });
    });
  }

  // --- State access ---
  getState(): Readonly<WearableState> { return this.state; }
  static isEnabled(): boolean { return JSTYLE_ENABLED; }

  // --- Subscriptions ---
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private patch(partial: Partial<WearableState>) {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((fn) => fn());
  }

  // --- Actions ---
  async scan() {
    this.patch({ devices: [], status: 'scanning' });
    await this.adapter.scan();
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
    this.patch({ connectedDevice: null, status: 'disconnected', diagnostics: null });
  }

  async sync(options?: { since?: string }) {
    if (!this.state.connectedDevice) return;
    const types: BiomarkerType[] = ['sleep', 'hrv', 'spo2', 'temp', 'steps', 'hr'];
    const progress = new Map<BiomarkerType, SyncProgress>();
    types.forEach((t) => progress.set(t, { type: t, status: 'pending' }));
    this.patch({ pendingSamples: new Map(), syncProgress: progress, status: 'syncing' });
    await this.adapter.sync(options);
  }

  /** Mark flush success */
  markFlushed() {
    const now = new Date().toISOString();
    this.patch({ pendingSamples: new Map(), lastSyncAt: now });
  }

  async isAvailable(): Promise<boolean> {
    return this.adapter.isAvailable();
  }
}

// Singleton
export const wearableStore = new WearableStore();
