/**
 * Health Lifecycle Manager
 *
 * Handles automatic reconnection and sync of HealthKit/Health Connect
 * on app startup, resume, and session changes. Ensures the wearable
 * connection persists until explicit logout.
 */

import { enableHealthKitBackgroundSync, isHealthKitAvailable, runIncrementalHealthSync } from './healthkit';
import { computeAndStoreState } from './vyr-recompute';

const MIN_SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes between auto-syncs
const LAST_AUTO_SYNC_KEY = 'vyr.health.lastAutoSync';

let lifecycleListenersBound = false;
let bootstrapInProgress = false;

/**
 * Check if enough time has passed since the last auto-sync.
 */
function shouldAutoSync(): boolean {
  const last = localStorage.getItem(LAST_AUTO_SYNC_KEY);
  if (!last) return true;
  return Date.now() - Number(last) > MIN_SYNC_INTERVAL_MS;
}

function markAutoSynced(): void {
  localStorage.setItem(LAST_AUTO_SYNC_KEY, String(Date.now()));
}

/**
 * Bootstrap health sync for an authenticated user with an active connection.
 *
 * Called on:
 * - App startup (if integration is active)
 * - App resume from background
 * - Session restoration
 *
 * Idempotent: safe to call multiple times. Debounces concurrent calls.
 */
export async function bootstrapHealthSync(): Promise<boolean> {
  if (bootstrapInProgress) return false;
  bootstrapInProgress = true;

  try {
    const available = await isHealthKitAvailable();
    if (!available) return false;

    // Re-register background delivery and observer queries
    await enableHealthKitBackgroundSync();

    // Auto-sync if enough time has passed
    if (shouldAutoSync()) {
      console.info('[health-lifecycle] Auto-sync triggered');
      const ok = await runIncrementalHealthSync('manual');
      if (ok) {
        markAutoSynced();
        try {
          await computeAndStoreState();
        } catch (err) {
          console.warn('[health-lifecycle] Post-sync compute failed:', err);
        }
      }
      return ok;
    }

    console.info('[health-lifecycle] Skipping auto-sync (throttled)');
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

  // Dynamic import to avoid breaking web builds
  import('@capacitor/app')
    .then(({ App }) => {
      App.addListener('resume', async () => {
        console.info('[health-lifecycle] App resumed — checking health sync');
        // Check if integration was active (stored flag)
        const wasActive = localStorage.getItem('vyr.health.connectionActive') === 'true';
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
      // Not running in Capacitor (web dev), ignore
      console.info('[health-lifecycle] Capacitor App plugin not available (web)');
    });
}

/**
 * Mark the health connection as active (persisted in localStorage).
 * Used by lifecycle listeners to know if auto-sync should run on resume.
 */
export function setConnectionActive(active: boolean): void {
  if (active) {
    localStorage.setItem('vyr.health.connectionActive', 'true');
  } else {
    localStorage.removeItem('vyr.health.connectionActive');
    localStorage.removeItem(LAST_AUTO_SYNC_KEY);
  }
}

/**
 * Check if the health connection was previously active.
 */
export function isConnectionActive(): boolean {
  return localStorage.getItem('vyr.health.connectionActive') === 'true';
}
