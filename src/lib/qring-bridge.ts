/**
 * qring-bridge.ts — TypeScript bridge for native QRingPlugin (Capacitor).
 * Mirrors the pattern from healthkit-bridge.ts.
 */

import { registerPlugin } from '@capacitor/core';

export interface QRingPluginInterface {
  isAvailable(): Promise<{ available: boolean }>;
  startScan(): Promise<void>;
  stopScan(): Promise<void>;
  connect(options: { deviceId: string }): Promise<{
    connected: boolean;
    name: string;
    mac: string;
    model: string;
    fwVersion: string;
    battery: number;
  }>;
  disconnect(): Promise<void>;
  sync(options?: { since?: string }): Promise<{ success: boolean }>;
  enableRealtime(options: { type: string }): Promise<{ success: boolean }>;
  configureAutoHR(options: { interval: number; enabled: boolean }): Promise<{
    enabled: boolean;
    interval: number;
  }>;
  addListener(event: string, handler: (data: any) => void): Promise<any>;
  removeAllListeners(): Promise<void>;
}

export const QRingPlugin = registerPlugin<QRingPluginInterface>('QRingPlugin');
