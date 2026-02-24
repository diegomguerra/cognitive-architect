import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';
import { WearableService } from '@/lib/wearable/wearable-service';
import type { WearableDevice, SyncProgress, BiomarkerType, DeviceDiagnostics, WearableConnectionStatus } from '@/lib/wearable/types';

const service = WearableService.getInstance();

/** React hook for wearable state & actions */
export function useWearable() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    return service.subscribe(() => forceUpdate((n) => n + 1));
  }, []);

  const status: WearableConnectionStatus = service.status;
  const devices: WearableDevice[] = service.devices;
  const connectedDevice: WearableDevice | null = service.connectedDevice;
  const syncProgress: Map<BiomarkerType, SyncProgress> = service.syncProgress;
  const diagnostics: DeviceDiagnostics | null = service.diagnostics;

  const scan = useCallback(() => service.scan(), []);
  const stopScan = useCallback(() => service.stopScan(), []);
  const connect = useCallback((id: string) => service.connect(id), []);
  const disconnect = useCallback(() => service.disconnect(), []);
  const sync = useCallback((opts?: { since?: string }) => service.sync(opts), []);
  const flush = useCallback(() => service.flushToBackend(), []);
  const isAvailable = useCallback(() => service.isAvailable(), []);

  return {
    enabled: WearableService.isEnabled(),
    status,
    devices,
    connectedDevice,
    syncProgress,
    diagnostics,
    scan,
    stopScan,
    connect,
    disconnect,
    sync,
    flushToBackend: flush,
    isAvailable,
  };
}
