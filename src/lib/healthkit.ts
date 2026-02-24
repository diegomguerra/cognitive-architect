/**
 * HealthKit integration via @capgo/capacitor-health (Capacitor 8)
 * + VYRHealthBridge for types not covered by the plugin.
 */

import { forceRefreshSession, requireValidUserId, retryOnAuthErrorLabeled } from './auth-session';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { VYRHealthBridge } from './healthkit-bridge';
import type { HealthDataType, HealthSample } from '@capgo/capacitor-health';

// Types the plugin supports natively
export const HEALTH_READ_TYPES: HealthDataType[] = [
  'heartRate', 'restingHeartRate', 'heartRateVariability', 'sleep', 'steps', 'oxygenSaturation', 'respiratoryRate',
];
export const HEALTH_WRITE_TYPES: HealthDataType[] = [
  'steps', 'heartRate', 'restingHeartRate', 'heartRateVariability', 'sleep', 'oxygenSaturation', 'respiratoryRate',
];

// Types handled exclusively by the Swift bridge (not in HealthDataType union)
export const BRIDGE_ONLY_READ_TYPES = [
  'bodyTemperature', 'vo2Max', 'activeEnergyBurned', 'bloodPressureSystolic', 'bloodPressureDiastolic',
] as const;
export const BRIDGE_ONLY_WRITE_TYPES = [
  'bodyTemperature', 'vo2Max', 'activeEnergyBurned', 'bloodPressureSystolic', 'bloodPressureDiastolic',
] as const;

// All types for background delivery (plugin + bridge)
const ALL_SYNC_TYPES = [...HEALTH_READ_TYPES, ...BRIDGE_ONLY_READ_TYPES.filter(t => !HEALTH_READ_TYPES.includes(t as any))];

const ANCHOR_PREFIX = 'healthkit.anchor.';
const SYNC_DEBOUNCE_MS = 1500;
let syncLock = false;
let syncDebounce: ReturnType<typeof setTimeout> | null = null;
let observerListenerBound = false;

export type HealthAuthorizationStatus = 'notDetermined' | 'sharingDenied' | 'sharingAuthorized' | 'unknown';

async function getAuthorizationStatuses(types: string[]): Promise<Record<string, HealthAuthorizationStatus>> {
  try {
    const { Health } = await import('@capgo/capacitor-health');
    const pluginTypes = types.filter(t => HEALTH_READ_TYPES.includes(t as HealthDataType)) as HealthDataType[];
    const result = await Health.checkAuthorization({ read: pluginTypes, write: pluginTypes });
    const statuses: Record<string, HealthAuthorizationStatus> = {};
    for (const t of pluginTypes) {
      statuses[t] = result.readAuthorized.includes(t) ? 'sharingAuthorized' : result.readDenied.includes(t) ? 'sharingDenied' : 'notDetermined';
    }
    // Bridge types
    const bridgeTypes = types.filter(t => !HEALTH_READ_TYPES.includes(t as HealthDataType));
    if (bridgeTypes.length > 0) {
      try {
        const bridgeResult = await VYRHealthBridge.getAuthorizationStatuses({ types: bridgeTypes });
        Object.assign(statuses, Object.fromEntries(bridgeTypes.map(t => [t, bridgeResult.statuses[t] ?? 'unknown'])));
      } catch {
        for (const t of bridgeTypes) statuses[t] = 'unknown';
      }
    }
    return statuses;
  } catch {
    return Object.fromEntries(types.map(t => [t, 'unknown' as HealthAuthorizationStatus]));
  }
}

export async function isHealthKitAvailable(): Promise<boolean> {
  try {
    const { Health } = await import('@capgo/capacitor-health');
    const result = await Health.isAvailable();
    console.log('[healthkit] isAvailable result:', JSON.stringify(result));
    return result.available;
  } catch (e) {
    console.error('[healthkit] isAvailable THREW:', e);
    // Fallback: se é iOS nativo, assume disponível e deixa o requestAuthorization decidir
    const isNative = !!(window as any).Capacitor?.isNativePlatform?.();
    console.log('[healthkit] isNativePlatform fallback:', isNative);
    return isNative;
  }
}

export async function requestHealthKitPermissions(): Promise<boolean> {
  try {
    const { Health } = await import('@capgo/capacitor-health');
    const allTypes = [...new Set([...HEALTH_READ_TYPES, ...HEALTH_WRITE_TYPES])];
    const beforeStatus = await getAuthorizationStatuses([...allTypes, ...BRIDGE_ONLY_READ_TYPES]);

    await Health.requestAuthorization({ read: HEALTH_READ_TYPES, write: HEALTH_WRITE_TYPES });

    const afterStatus = await getAuthorizationStatuses([...allTypes, ...BRIDGE_ONLY_READ_TYPES]);
    const grantedTypes = Object.entries(afterStatus).filter(([, s]) => s === 'sharingAuthorized').map(([t]) => t);
    const deniedTypes = Object.entries(afterStatus).filter(([, s]) => s === 'sharingDenied' || s === 'notDetermined').map(([t]) => t);

    console.info('[healthkit] authorization status', { beforeStatus, afterStatus, grantedTypesCount: grantedTypes.length, deniedTypes });

    await forceRefreshSession();
    return grantedTypes.length > 0;
  } catch (e) {
    console.error('[healthkit] Permission request failed:', e);
    await forceRefreshSession();
    return false;
  }
}

export async function writeHealthSample(dataType: string, value: number, startDate: string, endDate?: string): Promise<boolean> {
  try {
    // Bridge-only types
    if (dataType === 'bodyTemperature') {
      await VYRHealthBridge.writeBodyTemperature({ value, startDate, endDate });
      return true;
    }
    if (dataType === 'vo2Max') {
      await VYRHealthBridge.writeVO2Max({ value, startDate, endDate });
      return true;
    }
    if (dataType === 'activeEnergyBurned') {
      await VYRHealthBridge.writeActiveEnergyBurned({ value, startDate, endDate });
      return true;
    }

    // Plugin-supported types
    if (HEALTH_WRITE_TYPES.includes(dataType as HealthDataType)) {
      const { Health } = await import('@capgo/capacitor-health');
      await Health.saveSample({ dataType: dataType as HealthDataType, value, startDate, endDate: endDate ?? startDate });
      return true;
    }

    return false;
  } catch (error) {
    console.error('[healthkit] write sample failed', { dataType, error });
    return false;
  }
}

export async function writeBloodPressure(systolic: number, diastolic: number, startDate: string, endDate?: string): Promise<boolean> {
  try {
    await VYRHealthBridge.writeBloodPressure({ systolic, diastolic, startDate, endDate });
    return true;
  } catch (error) {
    console.error('[healthkit] write blood pressure failed', error);
    return false;
  }
}

export function calculateSleepQuality(samples: HealthSample[]): { durationHours: number; quality: number } {
  const validSamples = samples.filter((s) => s.sleepState && s.sleepState !== 'awake' && s.sleepState !== 'inBed');
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

  return {
    durationHours: totalMs / (1000 * 60 * 60),
    quality: Math.min(100, Math.round(((deepMs / totalMs) + (remMs / totalMs) * 2.5) * 100)),
  };
}

export function convertHRVtoScale(hrvMs: number): number {
  if (hrvMs <= 0) return 0;
  return Math.min(100, Math.round((Math.log(hrvMs) / Math.log(200)) * 100));
}

function getAnchor(type: string): string | undefined {
  return localStorage.getItem(`${ANCHOR_PREFIX}${type}`) ?? undefined;
}

function setAnchor(type: string, anchor?: string): void {
  if (!anchor) return;
  localStorage.setItem(`${ANCHOR_PREFIX}${type}`, anchor);
}

function setLastSyncTimestamp(type: string, iso: string): void {
  localStorage.setItem(`${ANCHOR_PREFIX}ts.${type}`, iso);
}

export async function enableHealthKitBackgroundSync(): Promise<void> {
  try {
    for (const type of ALL_SYNC_TYPES) {
      await VYRHealthBridge.enableBackgroundDelivery({ type: String(type), frequency: 'hourly' });
    }
    await VYRHealthBridge.registerObserverQueries({ types: ALL_SYNC_TYPES.map(String) });

    if (!observerListenerBound) {
      observerListenerBound = true;
      await VYRHealthBridge.addListener('healthkitObserverUpdated', () => {
        void runIncrementalHealthSync('observer');
      });
      await VYRHealthBridge.addListener('healthkitObserverError', (event) => {
        console.error('[healthkit] observer error', event);
      });
    }
  } catch (error) {
    console.error('[healthkit] enable background delivery failed', error);
  }
}

export async function runIncrementalHealthSync(trigger: 'manual' | 'observer' = 'manual'): Promise<boolean> {
  if (syncLock) return false;

  if (syncDebounce) clearTimeout(syncDebounce);
  await new Promise<void>((resolve) => {
    syncDebounce = setTimeout(() => resolve(), SYNC_DEBOUNCE_MS);
  });

  syncLock = true;
  try {
    let changed = false;
    for (const type of ALL_SYNC_TYPES) {
      const res = await VYRHealthBridge.readAnchored({ type: String(type), anchor: getAnchor(String(type)), limit: 200 });
      if ((res.samples?.length ?? 0) > 0) changed = true;
      setAnchor(String(type), res.newAnchor);
    }

    if (!changed && trigger === 'observer') return true;
    return await _syncHealthKitDataInternal();
  } catch (error) {
    console.error('[healthkit] incremental sync failed', error);
    return false;
  } finally {
    syncLock = false;
  }
}

export async function syncHealthKitData(): Promise<boolean> {
  if (syncLock) {
    console.warn('[healthkit] sync already in progress, skipping');
    return false;
  }
  syncLock = true;

  try {
    return await _syncHealthKitDataInternal();
  } catch (e) {
    console.error('[healthkit] sync exception:', e);
    return false;
  } finally {
    syncLock = false;
  }
}

/** Internal sync logic — callers must hold syncLock */
async function _syncHealthKitDataInternal(): Promise<boolean> {
  const available = await isHealthKitAvailable();
  if (!available) return false;

  const userId = await requireValidUserId();
  const { Health } = await import('@capgo/capacitor-health');
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const today = now.toISOString().split('T')[0];
  const queryOpts = { startDate: yesterday.toISOString(), endDate: now.toISOString(), limit: 500 };
  const empty = { samples: [] as HealthSample[] };

  const [rhrData, hrvData, sleepData, stepsData, spo2Data, rrData] = await Promise.all([
    Health.readSamples({ ...queryOpts, dataType: 'restingHeartRate' }).catch(() => empty),
    Health.readSamples({ ...queryOpts, dataType: 'heartRateVariability' }).catch(() => empty),
    Health.readSamples({ ...queryOpts, dataType: 'sleep' }).catch(() => empty),
    Health.readSamples({ ...queryOpts, dataType: 'steps' }).catch(() => empty),
    Health.readSamples({ ...queryOpts, dataType: 'oxygenSaturation' }).catch(() => empty),
    Health.readSamples({ ...queryOpts, dataType: 'respiratoryRate' }).catch(() => empty),
  ]);

  const { durationHours, quality: sleepQuality } = calculateSleepQuality(sleepData.samples);
  const avgHrv = hrvData.samples.length > 0 ? hrvData.samples.reduce((sum: number, s) => sum + s.value, 0) / hrvData.samples.length : undefined;
  const avgRhr = rhrData.samples.length > 0 ? rhrData.samples.reduce((sum: number, s) => sum + s.value, 0) / rhrData.samples.length : undefined;
  const totalSteps = stepsData.samples.reduce((sum: number, s) => sum + s.value, 0);
  const avgSpo2 = spo2Data.samples.length > 0 ? spo2Data.samples.reduce((sum: number, s) => sum + s.value, 0) / spo2Data.samples.length : undefined;
  const avgRR = rrData.samples.length > 0 ? rrData.samples.reduce((sum: number, s) => sum + s.value, 0) / rrData.samples.length : undefined;

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

  const result = await retryOnAuthErrorLabeled(async () => {
    const res = await supabase.from('ring_daily_data').upsert([{ user_id: userId, day: today, source_provider: 'apple_health', metrics: metrics as unknown as Json }], { onConflict: 'user_id,day,source_provider' }).select();
    return { data: res.data, error: res.error ? { code: (res.error as any).code, message: res.error.message } : null };
  }, { table: 'ring_daily_data', operation: 'upsert' });

  if (result.error) return false;

  await retryOnAuthErrorLabeled(async () => {
    const res = await supabase.from('user_integrations').upsert([{ user_id: userId, provider: 'apple_health', status: 'connected', last_sync_at: new Date().toISOString() }], { onConflict: 'user_id,provider' }).select();
    return { data: res.data, error: res.error ? { code: (res.error as any).code, message: res.error.message } : null };
  }, { table: 'user_integrations', operation: 'upsert' });

  const nowIso = now.toISOString();
  for (const dt of HEALTH_READ_TYPES) {
    setLastSyncTimestamp(dt, nowIso);
  }

  return true;
}
