import { registerPlugin } from '@capacitor/core';

export type BridgeAuthorizationStatus = 'notDetermined' | 'sharingDenied' | 'sharingAuthorized' | 'unknown';

export interface VYRHealthBridgePlugin {
  isHealthKitAvailable(): Promise<{ available: boolean }>;
  writeBodyTemperature(options: { value: number; startDate: string; endDate?: string }): Promise<{ success: boolean }>;
  writeBloodPressure(options: { systolic: number; diastolic: number; startDate: string; endDate?: string }): Promise<{ success: boolean }>;
  writeVO2Max(options: { value: number; startDate: string; endDate?: string }): Promise<{ success: boolean }>;
  writeActiveEnergyBurned(options: { value: number; startDate: string; endDate?: string }): Promise<{ success: boolean }>;
  getAuthorizationStatuses(options: { types: string[] }): Promise<{ statuses: Record<string, BridgeAuthorizationStatus> }>;
  enableBackgroundDelivery(options: { type: string; frequency?: 'immediate' | 'hourly' | 'daily' }): Promise<{ success: boolean }>;
  registerObserverQueries(options: { types: string[] }): Promise<{ registered: number }>;
  readAnchored(options: { type: string; anchor?: string; limit?: number }): Promise<{ samples: Array<Record<string, unknown>>; newAnchor?: string }>;

  // ── F1b: Extended reads (direct methods) ──────────────────────
  readBodyTemperature(options?: { limit?: number }): Promise<{ samples: Array<Record<string, unknown>>; newAnchor?: string }>;
  readBloodPressure(options?: { limit?: number }): Promise<{ samples: Array<{ systolic: number; diastolic: number; startDate: string; endDate: string; uuid?: string }>; newAnchor?: string }>;
  readVO2Max(options?: { limit?: number }): Promise<{ samples: Array<Record<string, unknown>>; newAnchor?: string }>;
  readActiveEnergyBurned(options?: { limit?: number }): Promise<{ samples: Array<Record<string, unknown>>; newAnchor?: string }>;
  readBasalEnergyBurned(options?: { limit?: number }): Promise<{ samples: Array<Record<string, unknown>>; newAnchor?: string }>;
  readRespiratoryRate(options?: { limit?: number }): Promise<{ samples: Array<Record<string, unknown>>; newAnchor?: string }>;
  readWalkingHeartRateAverage(options?: { limit?: number }): Promise<{ samples: Array<Record<string, unknown>>; newAnchor?: string }>;
  readHeartRateRecovery(options?: { limit?: number }): Promise<{ samples: Array<Record<string, unknown>>; newAnchor?: string }>;
  readSkinTemperature(options?: { limit?: number }): Promise<{ samples: Array<Record<string, unknown>>; newAnchor?: string }>;

  requestAuthorization(options: { readTypes?: string[]; writeTypes?: string[] }): Promise<{ granted: boolean }>;

  // FIX P1: Native persistence — anchors and connection state stored in UserDefaults,
  // not localStorage. Survives app reinstall, TestFlight public link installs, and
  // WKWebView container resets.
  resetAnchors(options?: { types?: string[] }): Promise<{ cleared: string[] }>;
  saveAnchor(options: { key: string; value: string }): Promise<{ saved: boolean }>;
  loadAnchor(options: { key: string }): Promise<{ value: string | null }>;
  saveConnectionState(options: { active: boolean; lastSync?: string }): Promise<{ saved: boolean }>;
  loadConnectionState(): Promise<{ active: boolean; lastSync: string | null }>;

  addListener(eventName: 'healthkitObserverUpdated', listenerFunc: (event: { type: string }) => void): Promise<{ remove: () => Promise<void> }>;
  addListener(eventName: 'healthkitObserverError', listenerFunc: (event: { type: string; error: string }) => void): Promise<{ remove: () => Promise<void> }>;
}

export const VYRHealthBridge = registerPlugin<VYRHealthBridgePlugin>('VYRHealthBridge');
