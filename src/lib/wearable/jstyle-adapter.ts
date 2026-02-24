/**
 * JStyleAdapter — Adapter for J-Style X3 ring.
 * Communicates with native Capacitor plugin (to be implemented separately).
 * The front-end NEVER touches BLE directly.
 */

import type {
  WearableAdapter,
  WearableDevice,
  WearableEvents,
  BiomarkerType,
  BiomarkerSample,
  DeviceDiagnostics,
} from './types';

type EventMap = {
  [K in keyof WearableEvents]: Set<WearableEvents[K]>;
};

/**
 * Stub adapter that delegates to a native Capacitor plugin.
 * In the browser (non-native), all methods return graceful fallbacks.
 * 
 * The native plugin should be registered as `JStylePlugin` on the Capacitor bridge
 * and mirror the WearableAdapter interface.
 */
export class JStyleAdapter implements WearableAdapter {
  private events: EventMap = {
    onDeviceFound: new Set(),
    onConnected: new Set(),
    onData: new Set(),
    onSyncEnd: new Set(),
    onError: new Set(),
  };

  private connectedDevice: WearableDevice | null = null;
  private diagnostics: DeviceDiagnostics | null = null;

  private get plugin(): any {
    // Capacitor plugin will be available as (window as any).Capacitor?.Plugins?.JStylePlugin
    return (window as any).Capacitor?.Plugins?.JStylePlugin ?? null;
  }

  private get isNative(): boolean {
    return !!(window as any).Capacitor?.isNativePlatform?.();
  }

  async isAvailable(): Promise<boolean> {
    if (!this.isNative) return false;
    try {
      const result = await this.plugin?.isAvailable();
      return result?.available === true;
    } catch {
      return false;
    }
  }

  async scan(): Promise<void> {
    if (!this.isNative) {
      this.emit('onError', 'NOT_NATIVE', 'BLE scan only available on native device');
      return;
    }
    try {
      // Register listener for discovered devices
      this.plugin?.addListener?.('deviceFound', (device: WearableDevice) => {
        this.emit('onDeviceFound', device);
      });
      await this.plugin?.startScan();
    } catch (e: any) {
      this.emit('onError', 'SCAN_FAILED', e?.message ?? 'Scan failed');
    }
  }

  async stopScan(): Promise<void> {
    try {
      await this.plugin?.stopScan();
    } catch {
      // silent
    }
  }

  async connect(deviceId: string): Promise<boolean> {
    if (!this.isNative) return false;
    try {
      const result = await this.plugin?.connect({ deviceId });
      if (result?.connected) {
        this.connectedDevice = {
          deviceId,
          name: result.name ?? 'J-Style X3',
          vendor: 'jstyle',
          model: result.model ?? 'X3',
          mac: result.mac,
        };
        this.diagnostics = {
          deviceId,
          mac: result.mac,
          fwVersion: result.fwVersion,
          battery: result.battery,
          lastError: undefined,
          lastSync: undefined,
        };
        this.emit('onConnected', this.connectedDevice);
        return true;
      }
      return false;
    } catch (e: any) {
      this.emit('onError', 'CONNECT_FAILED', e?.message ?? 'Connect failed');
      return false;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.plugin?.disconnect();
    } catch {
      // silent
    }
    this.connectedDevice = null;
  }

  async sync(options?: { since?: string }): Promise<void> {
    if (!this.connectedDevice) {
      this.emit('onError', 'NOT_CONNECTED', 'No device connected');
      return;
    }
    try {
      // Plugin calls back with data per type
      this.plugin?.addListener?.('syncData', (event: { type: BiomarkerType; samples: BiomarkerSample[] }) => {
        this.emit('onData', event.type, event.samples);
      });
      this.plugin?.addListener?.('syncEnd', (event: { type: BiomarkerType }) => {
        this.emit('onSyncEnd', event.type);
      });
      await this.plugin?.sync({ since: options?.since });
    } catch (e: any) {
      this.emit('onError', 'SYNC_FAILED', e?.message ?? 'Sync failed');
    }
  }

  async enableRealtime(type: BiomarkerType): Promise<void> {
    try {
      await this.plugin?.enableRealtime({ type });
    } catch (e: any) {
      this.emit('onError', 'REALTIME_FAILED', e?.message ?? 'Realtime failed');
    }
  }

  getDiagnostics(): DeviceDiagnostics | null {
    return this.diagnostics;
  }

  // Event system
  on<K extends keyof WearableEvents>(event: K, handler: WearableEvents[K]): void {
    (this.events[event] as Set<any>).add(handler);
  }

  off<K extends keyof WearableEvents>(event: K, handler: WearableEvents[K]): void {
    (this.events[event] as Set<any>).delete(handler);
  }

  private emit<K extends keyof WearableEvents>(event: K, ...args: Parameters<WearableEvents[K]>): void {
    (this.events[event] as Set<any>).forEach((fn: any) => {
      try { fn(...args); } catch { /* swallow */ }
    });
  }
}
