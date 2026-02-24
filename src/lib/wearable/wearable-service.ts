/**
 * WearableService — Singleton orchestrator.
 * Bridges the adapter (native plugin) ↔ Supabase backend.
 */

import { supabase } from '@/integrations/supabase/client';
import { requireValidUserId } from '@/lib/auth-session';
import { JStyleAdapter } from './jstyle-adapter';
import type {
  WearableAdapter,
  WearableDevice,
  BiomarkerType,
  BiomarkerSample,
  IngestBatchPayload,
  IngestBatchResponse,
  SyncProgress,
  DeviceDiagnostics,
  WearableConnectionStatus,
} from './types';

const JSTYLE_ENABLED = import.meta.env.VITE_JSTYLE_ENABLED !== 'false';
const DEV_MODE = import.meta.env.VITE_DEV_MODE === 'true';

function devLog(...args: unknown[]) {
  if (DEV_MODE) console.log('[Wearable]', ...args);
}

export class WearableService {
  private static instance: WearableService | null = null;
  private adapter: WearableAdapter;

  private _status: WearableConnectionStatus = 'idle';
  private _devices: WearableDevice[] = [];
  private _connectedDevice: WearableDevice | null = null;
  private _syncProgress: Map<BiomarkerType, SyncProgress> = new Map();
  private _pendingSamples: Map<BiomarkerType, BiomarkerSample[]> = new Map();
  private listeners = new Set<() => void>();

  private constructor() {
    this.adapter = new JStyleAdapter();
    this.setupListeners();
  }

  static getInstance(): WearableService {
    if (!WearableService.instance) {
      WearableService.instance = new WearableService();
    }
    return WearableService.instance;
  }

  static isEnabled(): boolean {
    return JSTYLE_ENABLED;
  }

  // --- State getters ---
  get status() { return this._status; }
  get devices() { return [...this._devices]; }
  get connectedDevice() { return this._connectedDevice; }
  get syncProgress() { return new Map(this._syncProgress); }
  get diagnostics(): DeviceDiagnostics | null { return this.adapter.getDiagnostics(); }

  // --- Subscribe to state changes ---
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private notify() {
    this.listeners.forEach((fn) => fn());
  }

  private setStatus(s: WearableConnectionStatus) {
    this._status = s;
    this.notify();
  }

  // --- Adapter event wiring ---
  private setupListeners() {
    this.adapter.on('onDeviceFound', (device) => {
      devLog('deviceFound', device);
      if (!this._devices.find((d) => d.deviceId === device.deviceId)) {
        this._devices = [...this._devices, device];
        this.notify();
      }
    });

    this.adapter.on('onConnected', (device) => {
      devLog('connected', device);
      this._connectedDevice = device;
      this.setStatus('connected');
    });

    this.adapter.on('onData', (type, samples) => {
      devLog('data', type, samples.length);
      const existing = this._pendingSamples.get(type) ?? [];
      this._pendingSamples.set(type, [...existing, ...samples]);
      this._syncProgress.set(type, { type, status: 'syncing', count: existing.length + samples.length });
      this.notify();
    });

    this.adapter.on('onSyncEnd', (type) => {
      devLog('syncEnd', type);
      this._syncProgress.set(type, {
        type,
        status: 'done',
        count: this._pendingSamples.get(type)?.length ?? 0,
      });
      this.notify();
    });

    this.adapter.on('onError', (code, message) => {
      devLog('error', code, message);
      this.setStatus('error');
    });
  }

  // --- Public API ---

  async isAvailable(): Promise<boolean> {
    return this.adapter.isAvailable();
  }

  async scan(): Promise<void> {
    this._devices = [];
    this.setStatus('scanning');
    await this.adapter.scan();
  }

  async stopScan(): Promise<void> {
    await this.adapter.stopScan();
    if (this._status === 'scanning') this.setStatus('idle');
  }

  async connect(deviceId: string): Promise<boolean> {
    const ok = await this.adapter.connect(deviceId);
    if (!ok) this.setStatus('error');
    return ok;
  }

  async disconnect(): Promise<void> {
    await this.adapter.disconnect();
    this._connectedDevice = null;
    this.setStatus('disconnected');
  }

  async sync(options?: { since?: string }): Promise<void> {
    if (!this._connectedDevice) return;
    this._pendingSamples.clear();

    const biomarkerTypes: BiomarkerType[] = ['sleep', 'hrv', 'spo2', 'temperature', 'steps', 'heartRate'];
    biomarkerTypes.forEach((t) => {
      this._syncProgress.set(t, { type: t, status: 'pending' });
    });

    this.setStatus('syncing');
    await this.adapter.sync(options);
  }

  /** Flush all pending samples to backend in a single batch call */
  async flushToBackend(): Promise<IngestBatchResponse | null> {
    const device = this._connectedDevice;
    if (!device) return null;

    const allSamples: BiomarkerSample[] = [];
    this._pendingSamples.forEach((samples) => allSamples.push(...samples));

    if (allSamples.length === 0) {
      devLog('flushToBackend: no samples');
      return null;
    }

    await requireValidUserId();

    const payload: IngestBatchPayload = {
      device_uid: device.deviceId,
      model: device.model,
      vendor: device.vendor,
      fw_version: this.diagnostics?.fwVersion,
      samples: allSamples,
    };

    devLog('flushToBackend', allSamples.length, 'samples');

    const { data, error } = await supabase.functions.invoke('ingest-biomarker-batch', {
      body: payload,
    });

    if (error) {
      devLog('flushToBackend error', error);
      return null;
    }

    this._pendingSamples.clear();
    devLog('flushToBackend result', data);
    return data as IngestBatchResponse;
  }
}
