/**
 * VYRHealthBridge — STUBBED 2026-05-16.
 *
 * O plugin nativo Swift continua compilado no app (não removemos o arquivo
 * `ios/App/App/VYRHealthBridge.swift`), mas o JS não o registra mais via
 * `registerPlugin`. Todas as chamadas viram no-ops ou retornam valores inertes.
 *
 * Ver [[project_vyr_391_issues]] (decisão de remover HealthKit) para
 * contexto. Arquivo pode ser deletado em release futura.
 */

export type BridgeAuthorizationStatus = 'notDetermined' | 'sharingDenied' | 'sharingAuthorized' | 'unknown';

export interface VYRHealthBridgePlugin {
  saveConnectionState(opts: { active: boolean; lastSync?: string }): Promise<void>;
  loadConnectionState(): Promise<{ active: boolean; lastSync: string | null }>;
  saveAnchor(opts: { key: string; value: string }): Promise<void>;
  loadAnchor(opts: { key: string }): Promise<{ value: string | null }>;
  getAuthorizationStatuses(opts: { types: string[] }): Promise<{ statuses: Record<string, BridgeAuthorizationStatus> }>;
  requestAuthorization(opts: { readTypes?: string[]; writeTypes?: string[] }): Promise<{ granted: boolean }>;
  enableBackgroundDelivery(opts: { type: string; frequency: string }): Promise<void>;
  registerObserverQueries(opts: { types: string[] }): Promise<void>;
  readAnchored(opts: { type: string; anchor?: string; limit?: number }): Promise<{ samples: unknown[]; nextAnchor?: string }>;
  readByDate(opts: { type: string; startDate: string; endDate: string; limit?: number }): Promise<{ samples: unknown[] }>;
  saveBiomarkerSamples(opts: { samples: unknown[] }): Promise<{ written: number; skipped: number; error?: string }>;
  writeBodyTemperature(opts: { value: number; startDate: string; endDate: string }): Promise<void>;
  writeVO2Max(opts: { value: number; startDate: string; endDate: string }): Promise<void>;
  writeActiveEnergyBurned(opts: { value: number; startDate: string; endDate: string }): Promise<void>;
  writeBloodPressure(opts: { systolic: number; diastolic: number; startDate: string; endDate: string }): Promise<void>;
  addListener(eventName: string, fn: (event: unknown) => void): Promise<{ remove: () => Promise<void> }>;
}

const STUB: VYRHealthBridgePlugin = {
  async saveConnectionState() {},
  async loadConnectionState() { return { active: false, lastSync: null }; },
  async saveAnchor() {},
  async loadAnchor() { return { value: null }; },
  async getAuthorizationStatuses() { return { statuses: {} }; },
  async requestAuthorization() { return { granted: false }; },
  async enableBackgroundDelivery() {},
  async registerObserverQueries() {},
  async readAnchored() { return { samples: [] }; },
  async readByDate() { return { samples: [] }; },
  async saveBiomarkerSamples() { return { written: 0, skipped: 0 }; },
  async writeBodyTemperature() {},
  async writeVO2Max() {},
  async writeActiveEnergyBurned() {},
  async writeBloodPressure() {},
  async addListener() { return { remove: async () => {} }; },
};

export const VYRHealthBridge = STUB;
