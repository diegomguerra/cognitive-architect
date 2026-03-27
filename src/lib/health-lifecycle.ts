/**
 * Health Lifecycle Manager
 *
 * FIX P1: Connection state (connectionActive, lastAutoSync) now persisted
 * via VYRHealthBridge.saveConnectionState() → UserDefaults on the native side.
 * localStorage is used only as a fallback for web/dev builds.
 *
 * This fixes the TestFlight public link issue where WKWebView container reset
 * erased localStorage, causing the app to "forget" the HealthKit connection.
 */

import { VYRHealthBridge } from './healthkit-bridge';
import { enableHealthKitBackgroundSync, isHealthKitAvailable, runIncrementalHealthSync } from './healthkit';
import { computeAndStoreState } from './vyr-recompute';

const MIN_SYNC_INTERVAL_MS = 15 * 60 * 1000;
const LS_LAST_SYNC_KEY = 'vyr.health.lastAutoSync';
const LS_ACTIVE_KEY = 'vyr.health.connectionActive';

let lifecycleListenersBound = false;
let bootstrapInProgress = false;

const isNativePlatform = (): boolean =>
  !!(window as any).Capacitor?.isNativePlatform?.();

/**
 * FIX P1: Load connection state from UserDefaults (native) or localStorage (web).
 */
async function loadNativeConnectionState(): Promise<{ active: boolean; lastSync: string | null }> {
  if (isNativePlatform()) {
    try {
      return await VYRHealthBridge.loadConnectionState();
    } catch {
      // Bridge unavailable — fall through to localStorage
    }
  }
  return {
    active: localStorage.getItem(LS_ACTIVE_KEY) === 'true',
    lastSync: localStorage.getItem(LS_LAST_SYNC_KEY),
  };
}

/**
 * FIX P1: Save connection state to UserDefaults (native) and localStorage (web).
 */
async function saveNativeConnectionState(active: boolean, lastSync?: string): Promise<void> {
  if (isNativePlatform()) {
    try {
      await VYRHealthBridge.saveConnectionState({ active, lastSync });
    } catch {
      // Fall through to localStorage
    }
  }
  if (active) {
    localStorage.setItem(LS_ACTIVE_KEY, 'true');
    if (lastSync) localStorage.setItem(LS_LAST_SYNC_KEY, lastSync);
  } else {
    localStorage.removeItem(LS_ACTIVE_KEY);
    localStorage.removeItem(LS_LAST_SYNC_KEY);
  }
}

async function shouldAutoSync(): Promise<boolean> {
  const { lastSync } = await loadNativeConnectionState();
  if (!lastSync) return true;
  return Date.now() - Number(lastSync) > MIN_SYNC_INTERVAL_MS;
}

async function markAutoSynced(): Promise<void> {
  const now = String(Date.now());
  // Persist timestamp alongside active flag
  const { active } = await loadNativeConnectionState();
  await saveNativeConnectionState(active, now);
}

/**
 * Bootstrap health sync for an authenticated user with an active connection.
 * Idempotent: safe to call multiple times. Debounces concurrent calls.
 */
export async function bootstrapHealthSync(): Promise<boolean> {
  if (bootstrapInProgress) return false;
  bootstrapInProgress = true;

  try {
    const available = await isHealthKitAvailable();
    if (!available) {
      try { await computeAndStoreState(); } catch {}
      return false;
    }

    // FIX P5 (via native side): registerObserverQueries is idempotent — safe to call on resume
    await enableHealthKitBackgroundSync();

    if (await shouldAutoSync()) {
      console.info('[health-lifecycle] Auto-sync triggered');
      const ok = await runIncrementalHealthSync('manual');
      if (ok) await markAutoSynced();
      return ok;
    }

    console.info('[health-lifecycle] Skipping auto-sync (throttled), ensuring state computed');
    try { await computeAndStoreState(); } catch {}
    return true;
  } catch (err) {
    console.error('[health-lifecycle] Bootstrap failed:', err);
    return false;
  } finally {
    bootstrapInProgress = false;
  }
}

/**
 * Set up Capacitor app lifecycle listeners (resume/pause).
 * Only binds once — safe to call multiple times.
 */
export function setupAppLifecycleListeners(onSyncComplete?: () => void): void {
  if (lifecycleListenersBound) return;
  lifecycleListenersBound = true;

  import('@capacitor/app')
    .then(({ App }) => {
      App.addListener('resume', async () => {
        console.info('[health-lifecycle] App resumed — checking health sync');
        // FIX P1: read active flag from UserDefaults, not localStorage
        const { active: wasActive } = await loadNativeConnectionState();
        if (wasActive) {
          const ok = await bootstrapHealthSync();
          if (ok && onSyncComplete) onSyncComplete();
        }
      });

      App.addListener('pause', () => {
        console.info('[health-lifecycle] App paused');
      });

      console.info('[health-lifecycle] Lifecycle listeners registered');
    })
    .catch(() => {
      console.info('[health-lifecycle] Capacitor App plugin not available (web)');
    });
}

/**
 * Mark the health connection as active. Persists to UserDefaults (native) + localStorage.
 */
export async function setConnectionActive(active: boolean): Promise<void> {
  await saveNativeConnectionState(active, active ? undefined : undefined);
}

/**
 * Check if the health connection was previously active.
 * FIX P1: reads from UserDefaults via native bridge, not localStorage.
 */
export async function isConnectionActive(): Promise<boolean> {
  const { active } = await loadNativeConnectionState();
  return active;
}
