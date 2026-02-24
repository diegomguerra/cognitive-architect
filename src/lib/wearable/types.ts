/** Wearable device discovered during BLE scan */
export interface WearableDevice {
  deviceId: string;
  name: string;
  mac?: string;
  rssi?: number;
  vendor: string;
  model: string;
}

/** Connection status */
export type WearableConnectionStatus =
  | 'idle'
  | 'scanning'
  | 'connected'
  | 'syncing'
  | 'disconnected'
  | 'error';

/** Biomarker types supported by J-Style X3 */
export type BiomarkerType =
  | 'sleep'
  | 'hrv'
  | 'spo2'
  | 'temperature'
  | 'steps'
  | 'heartRate';

/** Single biomarker sample from device */
export interface BiomarkerSample {
  type: BiomarkerType;
  ts: string; // ISO 8601
  end_ts?: string;
  value?: number | null;
  payload_json?: Record<string, unknown>;
  source?: string;
}

/** Sync progress for a specific type */
export interface SyncProgress {
  type: BiomarkerType;
  status: 'pending' | 'syncing' | 'done' | 'error';
  count?: number;
}

/** Device diagnostic info */
export interface DeviceDiagnostics {
  deviceId: string;
  mac?: string;
  fwVersion?: string;
  battery?: number;
  lastError?: string;
  lastSync?: string;
}

/** Events emitted by the wearable adapter */
export interface WearableEvents {
  onDeviceFound: (device: WearableDevice) => void;
  onConnected: (device: WearableDevice) => void;
  onData: (type: BiomarkerType, payload: BiomarkerSample[]) => void;
  onSyncEnd: (type: BiomarkerType) => void;
  onError: (code: string, message: string) => void;
}

/** Wearable adapter interface — the contract for any wearable plugin */
export interface WearableAdapter {
  scan(): Promise<void>;
  stopScan(): Promise<void>;
  connect(deviceId: string): Promise<boolean>;
  disconnect(): Promise<void>;
  sync(options?: { since?: string }): Promise<void>;
  enableRealtime(type: BiomarkerType): Promise<void>;
  getDiagnostics(): DeviceDiagnostics | null;
  isAvailable(): Promise<boolean>;

  // Event registration
  on<K extends keyof WearableEvents>(event: K, handler: WearableEvents[K]): void;
  off<K extends keyof WearableEvents>(event: K, handler: WearableEvents[K]): void;
}

/** Batch payload sent to edge function */
export interface IngestBatchPayload {
  device_uid: string;
  model: string;
  vendor?: string;
  fw_version?: string;
  samples: BiomarkerSample[];
}

/** Response from ingest edge function */
export interface IngestBatchResponse {
  success: boolean;
  device_id?: string;
  inserted: number;
  duplicates: number;
  errors: number;
  types: string[];
}
