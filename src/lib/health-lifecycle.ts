/**
 * Health Lifecycle Manager — Pós HealthKit removal (2026-05-16).
 *
 * Antes: orquestrava HealthKit sync + QRing + recompute.
 * Agora: QRing-only. HealthKit foi descontinuado do client; dados crus
 * vêm exclusivamente do anel via parse-vendor-raw no Supabase.
 *
 * Funções preservadas:
 *  - bootstrapHealthSync: QRing sync se houver anel pareado + recompute state
 *  - setupAppLifecycleListeners: resume/pause hooks
 *  - setConnectionActive / isConnectionActive: persistência via localStorage
 *  - startSyncCommandListener / handleSyncCommand: admin-triggered sync via Realtime
 *
 * Funções removidas: enableHealthKitBackgroundSync, syncHealthKitData,
 * runIncrementalHealthSync (todas viraram no-ops em [[healthkit.ts]]).
 */

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

async function loadNativeConnectionState(): Promise<{ active: boolean; lastSync: string | null }> {
  return {
    active: localStorage.getItem(LS_ACTIVE_KEY) === 'true',
    lastSync: localStorage.getItem(LS_LAST_SYNC_KEY),
  };
}

async function saveNativeConnectionState(active: boolean, lastSync?: string): Promise<void> {
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
  const { active } = await loadNativeConnectionState();
  await saveNativeConnectionState(active, now);
}

/**
 * Bootstrap sync para usuário autenticado. QRing-only.
 * Sempre tenta recomputar o state (mesmo sem sync — pode haver ring data
 * acumulada do dia anterior). Idempotente, debounce concorrente.
 */
export async function bootstrapHealthSync(): Promise<boolean> {
  if (bootstrapInProgress) return false;
  bootstrapInProgress = true;
  try {
    // Push token + sync handler (admin-triggered)
    const session = await supabase.auth.getSession();
    const uid = session.data?.session?.user?.id;
    if (uid) {
      await registerPushToken(uid);
      setupPushSyncHandler();
    }

    if (await shouldAutoSync()) {
      console.info('[health-lifecycle] Auto-sync triggered (QRing only)');
      const summary = await runQRingSyncIfPaired().catch(() => ({ ran: false }));
      if (summary.ran) await markAutoSynced();
      try { await computeAndStoreState(); } catch (e) { console.warn('[health-lifecycle] recompute failed:', e); }
      return summary.ran;
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
 * Capacitor app lifecycle listeners (resume/pause). Idempotente.
 */
export function setupAppLifecycleListeners(onSyncComplete?: () => void): void {
  if (lifecycleListenersBound) return;
  lifecycleListenersBound = true;

  import('@capacitor/app')
    .then(({ App }) => {
      App.addListener('resume', async () => {
        console.info('[health-lifecycle] App resumed');
        const { active: wasActive } = await loadNativeConnectionState();
        if (wasActive) {
          const ok = await bootstrapHealthSync();
          if (ok && onSyncComplete) onSyncComplete();
        }
        // Drain workaround: o app oficial QRing/Colmi drena o anel pro Apple Health
        // a cada sync, deixando nosso BLE vazio. Foreground-trigger QRing pra pegar
        // dados antes que o app oficial drene. Best-effort.
        try {
          const summary = await runQRingSyncIfPaired();
          if (summary.ran) {
            console.info('[health-lifecycle] foreground QRing sync:', summary);
            if (onSyncComplete) onSyncComplete();
          }
        } catch (e) {
          console.warn('[health-lifecycle] foreground QRing sync threw (non-fatal):', e);
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

export async function isConnectionActive(): Promise<boolean> {
  const { active } = await loadNativeConnectionState();
  return active;
}

/**
 * Handle remote sync command (admin dashboard via sync_commands realtime).
 * QRing-only — HealthKit removido. Source = 'qring_ble'.
 */
async function handleSyncCommand(commandId: string, command: string): Promise<void> {
  console.info('[health-lifecycle] Received remote sync command:', command, '(id:', commandId, ')');

  await supabase
    .from('sync_commands')
    .update({ status: 'received', updated_at: new Date().toISOString() })
    .eq('id', commandId);

  try {
    let qringSummary: Awaited<ReturnType<typeof runQRingSyncIfPaired>> = { ran: false };
    try {
      qringSummary = await runQRingSyncIfPaired();
      console.info('[health-lifecycle] QRing sync summary:', qringSummary);
    } catch (e: any) {
      console.warn('[health-lifecycle] QRing sync threw (non-fatal):', e);
      qringSummary = { ran: true, reason: 'exception', inserted: 0, duplicates: 0, errors: 1 };
    }

    let vyrRecomputed = false;
    try {
      await computeAndStoreState();
      vyrRecomputed = true;
    } catch (e: any) {
      console.warn('[health-lifecycle] VYR recompute threw (non-fatal):', e);
    }

    const overallOk = qringSummary.ran;

    await supabase
      .from('sync_commands')
      .update({
        status: overallOk ? 'completed' : 'failed',
        updated_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        result: {
          synced_at: new Date().toISOString(),
          source: 'qring_ble',
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

export function startSyncCommandListener(userId: string): void {
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

  void (async () => {
    try {
      const { data: pending } = await supabase
        .from('sync_commands')
        .select('id, command')
        .eq('user_id', userId)
        .in('status', ['pending', 'sent'])
        .order('created_at', { ascending: true })
        .limit(20);

      if (pending && pending.length > 0) {
        console.info('[health-lifecycle] Draining', pending.length, 'pending sync command(s) on mount');
        for (const cmd of pending) {
          await handleSyncCommand(cmd.id, cmd.command);
        }
      }
    } catch (e) {
      console.warn('[health-lifecycle] Failed to check pending sync commands:', e);
    }
  })();
}

export function stopSyncCommandListener(): void {
  if (syncCommandChannel) {
    supabase.removeChannel(syncCommandChannel);
    syncCommandChannel = null;
  }
}
