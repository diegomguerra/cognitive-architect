/**
 * wearable.sync — Orchestrates flush of pending samples to backend.
 * ALL biomarker writes go through the Edge Function. NEVER direct inserts.
 */

import { supabase } from '@/integrations/supabase/client';
import { requireValidUserId } from '@/lib/auth-session';
import { wearableStore } from './wearable.store';
import { wlog, werror, nextRequestId } from './jstyle/wearable.telemetry';
import type { IngestBatchPayload, IngestBatchResponse, BiomarkerSample } from './jstyle/wearable.types';

/** Biomarker types that have no clean HealthKit mapping — never forwarded. */
const HK_SKIP_TYPES = new Set<string>(['sleep', 'stress', 'debug_raw']);

/**
 * Hybrid path: in addition to ingesting via the edge function, also write
 * biomarker samples to HealthKit so they're visible to Apple Health and any
 * other native health app on the device. Best-effort — failures don't block
 * the canonical Supabase ingest. iOS-only (web/Android no-op).
 *
 * Reused by ANY wearable adapter (QRing, J-Style, Garmin, Oura) via the
 * shared `flushSamplesToBackend` flow below.
 */
async function writeSamplesToHealthKit(samples: BiomarkerSample[]): Promise<void> {
  const w = window as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, { saveBiomarkerSamples?: (a: { samples: unknown[] }) => Promise<unknown> }> } };
  if (!w.Capacitor?.isNativePlatform?.()) return;
  const bridge = w.Capacitor.Plugins?.VYRHealthBridge;
  if (!bridge?.saveBiomarkerSamples) return;
  const filtered = samples.filter((s) => !HK_SKIP_TYPES.has(s.type));
  if (filtered.length === 0) return;
  try {
    const r = (await bridge.saveBiomarkerSamples({ samples: filtered })) as { written?: number; skipped?: number; error?: string };
    wlog('sync', 'healthkit hybrid write', {
      written: r?.written ?? 0,
      skipped: r?.skipped ?? 0,
      error: r?.error,
    });
  } catch (e) {
    // Permission denied / not authorized — swallow, Supabase ingest already succeeded
    wlog('sync', 'healthkit hybrid write skipped', { reason: (e as Error)?.message ?? 'unknown' });
  }
}

const LS_LAST_QRING_DEVICE = 'vyr.qring.lastDeviceId';
const LS_LAST_QRING_NAME = 'vyr.qring.lastDeviceName';

/**
 * Flush all pending samples to backend via ingest-biomarker-batch Edge Function.
 * Returns the response or null on failure.
 */
export async function flushSamplesToBackend(): Promise<IngestBatchResponse | null> {
  const state = wearableStore.getState();
  const device = state.connectedDevice;

  if (!device) {
    werror('sync', 'flushSamplesToBackend called without connected device');
    return null;
  }

  const allSamples: BiomarkerSample[] = [];
  state.pendingSamples.forEach((samples) => allSamples.push(...samples));

  if (allSamples.length === 0) {
    wlog('sync', 'no samples to flush');
    return null;
  }

  const requestId = nextRequestId();
  wlog('sync', `flush start [${requestId}]`, { count: allSamples.length, device: device.deviceId });

  // Ensure valid session before calling edge function
  await requireValidUserId();

  const diagnostics = wearableStore.getState().diagnostics;

  const payload: IngestBatchPayload = {
    vendor: device.vendor,
    model: device.model,
    device_uid: device.mac || device.deviceId,
    fw_version: diagnostics?.fwVersion ?? null,
    samples: allSamples,
  };

  const { data, error } = await supabase.functions.invoke('ingest-biomarker-batch', {
    body: payload,
  });

  if (error) {
    werror('sync', `flush failed [${requestId}]`, error.message);
    return null;
  }

  const result = data as IngestBatchResponse;
  wlog('sync', `flush done [${requestId}]`, {
    inserted: result.inserted,
    duplicates: result.duplicates,
    errors: result.errors,
  });

  // Hybrid: also forward to HealthKit so native apps see the data.
  // Doesn't block — fires after Supabase ingest succeeds.
  void writeSamplesToHealthKit(allSamples);

  wearableStore.markFlushed();
  return result;
}

/**
 * Persist last paired QRing so admin-triggered syncs can best-effort reconnect.
 * Called from QRingPanel after successful connect.
 */
export function rememberPairedQRing(deviceId: string, name?: string): void {
  try {
    localStorage.setItem(LS_LAST_QRING_DEVICE, deviceId);
    if (name) localStorage.setItem(LS_LAST_QRING_NAME, name);
  } catch { /* noop */ }
}

export function forgetPairedQRing(): void {
  try {
    localStorage.removeItem(LS_LAST_QRING_DEVICE);
    localStorage.removeItem(LS_LAST_QRING_NAME);
  } catch { /* noop */ }
}

export function getLastPairedQRing(): { deviceId: string; name: string | null } | null {
  try {
    const id = localStorage.getItem(LS_LAST_QRING_DEVICE);
    if (!id) return null;
    return { deviceId: id, name: localStorage.getItem(LS_LAST_QRING_NAME) };
  } catch {
    return null;
  }
}

/**
 * Run a full QRing sync if a ring is paired (currently connected OR previously paired).
 * Best-effort: silently skips if no ring, reconnect fails, or BLE unavailable.
 *
 * Returns a summary of what happened (for logging / admin command result).
 */
export async function runQRingSyncIfPaired(): Promise<{
  ran: boolean;
  reason?: string;
  inserted?: number;
  duplicates?: number;
  errors?: number;
}> {
  if (!wearableStore.constructor.prototype.isAvailable) {
    // Paranoid guard — method always exists, but keep TS happy
  }

  // Check native BLE availability (web dev builds return false)
  const available = await wearableStore.isAvailable().catch(() => false);
  if (!available) return { ran: false, reason: 'ble_unavailable' };

  let connected = wearableStore.getState().connectedDevice;

  // If not connected, try to reconnect to last paired device
  if (!connected) {
    const last = getLastPairedQRing();
    if (!last) return { ran: false, reason: 'no_paired_device' };

    wlog('sync', 'QRing not connected — attempting reconnect', { deviceId: last.deviceId });
    const ok = await wearableStore.connect(last.deviceId).catch(() => false);
    if (!ok) return { ran: false, reason: 'reconnect_failed' };
    connected = wearableStore.getState().connectedDevice;
    if (!connected) return { ran: false, reason: 'reconnect_no_state' };
  }

  // Run full sync protocol
  try {
    await wearableStore.sync();
  } catch (e: any) {
    werror('sync', 'QRing sync threw', e?.message ?? String(e));
    return { ran: true, reason: 'sync_exception', inserted: 0, duplicates: 0, errors: 1 };
  }

  // Flush to backend
  const r = await flushSamplesToBackend();
  if (!r) return { ran: true, reason: 'no_samples_or_flush_failed', inserted: 0, duplicates: 0, errors: 0 };

  return {
    ran: true,
    inserted: r.inserted ?? 0,
    duplicates: r.duplicates ?? 0,
    errors: r.errors ?? 0,
  };
}
