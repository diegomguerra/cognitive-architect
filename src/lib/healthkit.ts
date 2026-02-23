/**
 * HealthKit integration via @capgo/capacitor-health (Capacitor 8)
 * Handles read+write for types supported by the plugin.
 * Types NOT supported by plugin (bodyTemperature, bloodPressure, vo2Max, activeEnergy)
 * are handled by the native VYRHealthBridge — see healthkit-bridge.ts.
 *
 * "Stress" is a DERIVED metric — never written to HealthKit.
 */

import { forceRefreshSession, requireValidUserId, retryOnAuthErrorLabeled } from './auth-session';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import type { HealthDataType, HealthSample } from '@capgo/capacitor-health';

// ── Types ────────────────────────────────────────────────────────────

export const HEALTH_READ_TYPES: HealthDataType[] = [
  'heartRate',
  'restingHeartRate',
  'heartRateVariability',
  'sleep',
  'steps',
  'oxygenSaturation',
  'respiratoryRate',
];

export const HEALTH_WRITE_TYPES: HealthDataType[] = [
  'steps',
  'heartRate',
  'restingHeartRate',
  'heartRateVariability',
  'sleep',
  'oxygenSaturation',
  'respiratoryRate',
];

export interface SleepSampleProcessed {
  sleepState: string;
  startDate: string;
  endDate: string;
  value: number;
}

export interface AuthorizationStatusResult {
  readAuthorized: string[];
  readDenied: string[];
  writeAuthorized: string[];
  writeDenied: string[];
}

// ── Availability ─────────────────────────────────────────────────────

export async function isHealthKitAvailable(): Promise<boolean> {
  try {
    const { Health } = await import('@capgo/capacitor-health');
    const result = await Health.isAvailable();
    return result.available;
  } catch {
    return false;
  }
}

// ── Authorization ────────────────────────────────────────────────────

/**
 * Request HealthKit read+write permissions.
 * Returns true if the dialog was shown (does NOT mean all types were granted).
 */
export async function requestHealthKitPermissions(): Promise<boolean> {
  try {
    const { Health } = await import('@capgo/capacitor-health');
    await Health.requestAuthorization({
      read: HEALTH_READ_TYPES,
      write: HEALTH_WRITE_TYPES,
    });
    // Force session refresh after native dialog
    await forceRefreshSession();
    return true;
  } catch (e) {
    console.error('[healthkit] Permission request failed:', e);
    await forceRefreshSession();
    return false;
  }
}

/**
 * Check authorization status per type BEFORE and AFTER requesting.
 * Uses plugin's checkAuthorization to get granular status.
 */
export async function checkHealthKitAuth(): Promise<AuthorizationStatusResult | null> {
  try {
    const { Health } = await import('@capgo/capacitor-health');
    const result = await Health.checkAuthorization({
      read: HEALTH_READ_TYPES,
      write: HEALTH_WRITE_TYPES,
    });

    const status: AuthorizationStatusResult = {
      readAuthorized: [],
      readDenied: [],
      writeAuthorized: [],
      writeDenied: [],
    };

    // Parse plugin response — checkAuthorization returns per-type status
    if (result && typeof result === 'object') {
      for (const t of HEALTH_READ_TYPES) {
        const key = `read_${t}`;
        if ((result as any)[key] === true || (result as any)[t] === true) {
          status.readAuthorized.push(t);
        } else {
          status.readDenied.push(t);
        }
      }
      for (const t of HEALTH_WRITE_TYPES) {
        const key = `write_${t}`;
        if ((result as any)[key] === true) {
          status.writeAuthorized.push(t);
        } else {
          status.writeDenied.push(t);
        }
      }
    }

    console.info('[healthkit] auth status:', status);
    return status;
  } catch (e) {
    console.warn('[healthkit] checkAuthorization failed:', e);
    return null;
  }
}

// ── Write samples via plugin ─────────────────────────────────────────

/**
 * Write a single sample to Apple Health via the plugin.
 * Only for types in HEALTH_WRITE_TYPES.
 * For bodyTemperature, bloodPressure, vo2Max, activeEnergy → use healthkit-bridge.ts.
 * For stress → NEVER write to HealthKit (derived metric, Supabase only).
 */
export async function writeHealthKitSample(
  dataType: HealthDataType,
  value: number,
  opts?: { startDate?: string; endDate?: string; unit?: string }
): Promise<boolean> {
  try {
    const { Health } = await import('@capgo/capacitor-health');
    await Health.saveSample({
      dataType,
      value,
      startDate: opts?.startDate ?? new Date().toISOString(),
      endDate: opts?.endDate,
      unit: opts?.unit as any,
    });
    console.info('[healthkit][WRITE] saved', { dataType, value });
    return true;
  } catch (e) {
    console.error('[healthkit][WRITE] failed', { dataType, error: e });
    return false;
  }
}

// ── Sleep quality calculation ────────────────────────────────────────

export function calculateSleepQuality(samples: HealthSample[]): {
  durationHours: number;
  quality: number;
} {
  const validSamples = samples.filter(
    (s) => s.sleepState && s.sleepState !== 'awake' && s.sleepState !== 'inBed'
  );

  if (validSamples.length === 0) return { durationHours: 0, quality: 0 };

  let totalMs = 0;
  let deepMs = 0;
  let remMs = 0;

  for (const s of validSamples) {
    const ms = new Date(s.endDate).getTime() - new Date(s.startDate).getTime();
    totalMs += ms;
    if (s.sleepState === 'deep') deepMs += ms;
    if (s.sleepState === 'rem') remMs += ms;
  }

  if (totalMs === 0) return { durationHours: 0, quality: 0 };

  const deepPct = deepMs / totalMs;
  const remPct = remMs / totalMs;
  const quality = Math.min(100, Math.round((deepPct + remPct * 2.5) * 100));

  return {
    durationHours: totalMs / (1000 * 60 * 60),
    quality,
  };
}

// ── HRV conversion ───────────────────────────────────────────────────

export function convertHRVtoScale(hrvMs: number): number {
  if (hrvMs <= 0) return 0;
  return Math.min(100, Math.round((Math.log(hrvMs) / Math.log(200)) * 100));
}

// ── Incremental sync helpers ─────────────────────────────────────────

const ANCHOR_PREFIX = 'hk_last_sync_';

function getLastSyncTimestamp(dataType: string): string {
  try {
    const stored = localStorage.getItem(`${ANCHOR_PREFIX}${dataType}`);
    if (stored) return stored;
  } catch { /* localStorage unavailable */ }
  // Default: 24h ago
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

function setLastSyncTimestamp(dataType: string, ts: string): void {
  try {
    localStorage.setItem(`${ANCHOR_PREFIX}${dataType}`, ts);
  } catch { /* localStorage unavailable */ }
}

// ── Sync HealthKit data to Supabase (incremental) ────────────────────

let syncLock = false;

export async function syncHealthKitData(): Promise<boolean> {
  // Debounce / lock
  if (syncLock) {
    console.warn('[healthkit] sync already in progress, skipping');
    return false;
  }
  syncLock = true;

  try {
    const available = await isHealthKitAvailable();
    if (!available) {
      console.warn('[healthkit] HealthKit not available');
      return false;
    }

    const userId = await requireValidUserId();
    const { Health } = await import('@capgo/capacitor-health');

    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // Build per-type query windows (incremental via timestamp anchor)
    const buildOpts = (dataType: string) => ({
      startDate: getLastSyncTimestamp(dataType),
      endDate: now.toISOString(),
      limit: 500,
    });

    const empty = { samples: [] as HealthSample[] };
    const [hrData, rhrData, hrvData, sleepData, stepsData, spo2Data, rrData] =
      await Promise.all([
        Health.readSamples({ ...buildOpts('heartRate'), dataType: 'heartRate' }).catch(() => empty),
        Health.readSamples({ ...buildOpts('restingHeartRate'), dataType: 'restingHeartRate' }).catch(() => empty),
        Health.readSamples({ ...buildOpts('heartRateVariability'), dataType: 'heartRateVariability' }).catch(() => empty),
        Health.readSamples({ ...buildOpts('sleep'), dataType: 'sleep' }).catch(() => empty),
        Health.readSamples({ ...buildOpts('steps'), dataType: 'steps' }).catch(() => empty),
        Health.readSamples({ ...buildOpts('oxygenSaturation'), dataType: 'oxygenSaturation' }).catch(() => empty),
        Health.readSamples({ ...buildOpts('respiratoryRate'), dataType: 'respiratoryRate' }).catch(() => empty),
      ]);

    console.info('[healthkit] samples read (incremental)', {
      hr: hrData.samples.length,
      rhr: rhrData.samples.length,
      hrv: hrvData.samples.length,
      sleep: sleepData.samples.length,
      steps: stepsData.samples.length,
      spo2: spo2Data.samples.length,
      rr: rrData.samples.length,
    });

    // Process
    const { durationHours, quality: sleepQuality } = calculateSleepQuality(sleepData.samples);
    const avgHrv = hrvData.samples.length > 0
      ? hrvData.samples.reduce((sum: number, s) => sum + s.value, 0) / hrvData.samples.length
      : undefined;
    const avgRhr = rhrData.samples.length > 0
      ? rhrData.samples.reduce((sum: number, s) => sum + s.value, 0) / rhrData.samples.length
      : undefined;
    const totalSteps = stepsData.samples.reduce((sum: number, s) => sum + s.value, 0);
    const avgSpo2 = spo2Data.samples.length > 0
      ? spo2Data.samples.reduce((sum: number, s) => sum + s.value, 0) / spo2Data.samples.length
      : undefined;
    const avgRR = rrData.samples.length > 0
      ? rrData.samples.reduce((sum: number, s) => sum + s.value, 0) / rrData.samples.length
      : undefined;

    const metrics = {
      rhr: avgRhr ? Math.round(avgRhr) : null,
      hrv_sdnn: avgHrv ? Math.round(avgHrv * 10) / 10 : null,
      hrv_index: avgHrv ? convertHRVtoScale(avgHrv) : null,
      sleep_duration_hours: Math.round(durationHours * 10) / 10,
      sleep_quality: sleepQuality,
      steps: totalSteps,
      spo2: avgSpo2 ? Math.round(avgSpo2 * 10) / 10 : null,
      respiratory_rate: avgRR ? Math.round(avgRR * 10) / 10 : null,
    };

    console.info('[healthkit] metrics computed', {
      rhr: metrics.rhr,
      hrv: metrics.hrv_sdnn,
      sleep: metrics.sleep_duration_hours,
      steps: metrics.steps,
    });

    // Upsert to ring_daily_data
    const result = await retryOnAuthErrorLabeled(async () => {
      const res = await supabase
        .from('ring_daily_data')
        .upsert(
          [{
            user_id: userId,
            day: today,
            source_provider: 'apple_health',
            metrics: metrics as unknown as Json,
          }],
          { onConflict: 'user_id,day,source_provider' }
        )
        .select();
      return {
        data: res.data,
        error: res.error
          ? { code: (res.error as any).code, message: res.error.message, details: (res.error as any).details, hint: (res.error as any).hint }
          : null,
      };
    }, { table: 'ring_daily_data', operation: 'upsert' });

    if (result.error) {
      return false;
    }

    // Update user_integrations
    await retryOnAuthErrorLabeled(async () => {
      const res = await supabase
        .from('user_integrations')
        .upsert(
          [{
            user_id: userId,
            provider: 'apple_health',
            status: 'connected',
            last_sync_at: new Date().toISOString(),
          }],
          { onConflict: 'user_id,provider' }
        )
        .select();
      return {
        data: res.data,
        error: res.error
          ? { code: (res.error as any).code, message: res.error.message, details: (res.error as any).details, hint: (res.error as any).hint }
          : null,
      };
    }, { table: 'user_integrations', operation: 'upsert' });

    // Update anchors (timestamp-based incremental)
    const nowIso = now.toISOString();
    for (const dt of ['heartRate', 'restingHeartRate', 'heartRateVariability', 'sleep', 'steps', 'oxygenSaturation', 'respiratoryRate']) {
      setLastSyncTimestamp(dt, nowIso);
    }

    return true;
  } catch (e) {
    console.error('[DB][ERR] syncHealthKitData exception:', e);
    return false;
  } finally {
    syncLock = false;
  }
}
