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
import { enableHealthKitBackgroundSync, isHealthKitAvailable, runIncrementalHealthSync, syncHealthKitData } from './healthkit';
import { computeAndStoreState } from './vyr-recompute';
import { registerPushToken, setupPushSyncHandler, unregisterPushToken } from './push-sync';
import { runQRingSyncIfPaired } from '@/wearables/wearable.sync';
import { supabase } from '@/integrations/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';

const MIN_SYNC_INTERVAL_MS = 15 * 60 * 1000;
const LS_LAST_SYNC_KEY = 'vyr.health.lastAutoSync';
const LS_ACTIVE_KEY = 'vyr.health.connectionActive';

let lifecycleListenersBound = false;
let bootstrapInProgress = false;
let syncCommandChannel: RealtimeChannel | null = null;

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

    // Register push token for background sync via admin dashboard
    const session = await supabase.auth.getSession();
    const uid = session.data?.session?.user?.id;
    if (uid) {
      await registerPushToken(uid);
      setupPushSyncHandler();
    }

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
 * On deactivation, also deactivates push token.
 */
export async function setConnectionActive(active: boolean): Promise<void> {
  await saveNativeConnectionState(active, active ? undefined : undefined);
  if (!active) {
    const session = await supabase.auth.getSession();
    const uid = session.data?.session?.user?.id;
    if (uid) {
      await unregisterPushToken(uid);
    }
  }
}

/**
 * Check if the health connection was previously active.
 * FIX P1: reads from UserDefaults via native bridge, not localStorage.
 */
export async function isConnectionActive(): Promise<boolean> {
  const { active } = await loadNativeConnectionState();
  return active;
}

/**
 * Handle a remote sync command from the admin dashboard.
 * Triggers a full sync and updates the command status in Supabase.
 */
async function handleSyncCommand(commandId: string, command: string): Promise<void> {
  console.info('[health-lifecycle] Received remote sync command:', command, '(id:', commandId, ')');

  // Mark as received
  await supabase
    .from('sync_commands')
    .update({ status: 'received', updated_at: new Date().toISOString() })
    .eq('id', commandId);

  try {
    // 1. HealthKit sync — primary source on iOS
    const healthKitOk = await syncHealthKitData();

    // 2. QRing BLE sync — best-effort, only runs if a ring is paired
    let qringSummary: Awaited<ReturnType<typeof runQRingSyncIfPaired>> = { ran: false };
    try {
      qringSummary = await runQRingSyncIfPaired();
      console.info('[health-lifecycle] QRing sync summary:', qringSummary);
    } catch (e: any) {
      console.warn('[health-lifecycle] QRing sync threw (non-fatal):', e);
      qringSummary = { ran: true, reason: 'exception', inserted: 0, duplicates: 0, errors: 1 };
    }

    // 3. Refresh VYR state (compute from ring_daily_data + biomarker_samples)
    let vyrRecomputed = false;
    try {
      await computeAndStoreState();
      vyrRecomputed = true;
    } catch (e: any) {
      console.warn('[health-lifecycle] VYR recompute threw (non-fatal):', e);
    }

    const overallOk = healthKitOk; // HealthKit is the primary contract for "success"

    await supabase
      .from('sync_commands')
      .update({
        status: overallOk ? 'completed' : 'failed',
        updated_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        result: {
          synced_at: new Date().toISOString(),
          source: 'apple_health',
          healthkit_ok: healthKitOk,
          qring: qringSummary,
          vyr_recomputed: vyrRecomputed,
        },
      })
      .eq('id', commandId);

    console.info('[health-lifecycle] Remote sync', overallOk ? 'completed' : 'failed',
      '— QRing ran:', qringSummary.ran, 'VYR recomputed:', vyrRecomputed);
  } catch (e: any) {
    console.error('[health-lifecycle] Remote sync error:', e);
    await supabase
      .from('sync_commands')
      .update({
        status: 'failed',
        updated_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        result: { error: e?.message || 'Unknown error' },
      })
      .eq('id', commandId);
  }
}

/**
 * Subscribe to sync_commands via Supabase Realtime for admin-triggered syncs.
 * Also checks for any pending commands on startup.
 */
export function startSyncCommandListener(userId: string): void {
  // Clean up previous channel
  stopSyncCommandListener();

  syncCommandChannel = supabase
    .channel(`sync-commands-${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'sync_commands',
        filter: `user_id=eq.${userId}`,
      },
      (payload: any) => {
        const record = payload.new;
        if (record && (record.status === 'pending' || record.status === 'sent')) {
          void handleSyncCommand(record.id, record.command);
        }
      }
    )
    .subscribe((status: string) => {
      console.info('[health-lifecycle] sync_commands realtime:', status);
    });

  // Check for pending commands on startup — drains ALL pending/sent commands
  // (previously only drained 1). This is important for users who opened the
  // app after multiple admin-triggered syncs queued up.
  void (async () => {
    try {
      const { data: pending } = await supabase
        .from('sync_commands')
        .select('id, command')
        .eq('user_id', userId)
        .in('status', ['pending', 'sent'])
        .order('created_at', { ascending: true }) // oldest first
        .limit(20);

      if (pending && pending.length > 0) {
        console.info('[health-lifecycle] Draining', pending.length, 'pending sync command(s) on mount');
        for (const cmd of pending) {
          // sequential await — let each sync finish before next
          await handleSyncCommand(cmd.id, cmd.command);
        }
      }
    } catch (e) {
      console.warn('[health-lifecycle] Failed to check pending sync commands:', e);
    }
  })();
}

/**
 * Unsubscribe from sync_commands Realtime channel.
 */
export function stopSyncCommandListener(): void {
  if (syncCommandChannel) {
    supabase.removeChannel(syncCommandChannel);
    syncCommandChannel = null;
  }
}
