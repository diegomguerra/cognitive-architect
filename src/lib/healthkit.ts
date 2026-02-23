/**
 * HealthKit integration via @capgo/capacitor-health (Capacitor 8)
 */

import { forceRefreshSession, requireValidUserId, retryOnAuthErrorLabeled } from './auth-session';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { VYRHealthBridge } from './healthkit-bridge';
import type { HealthDataType, HealthSample } from '@capgo/capacitor-health';

export const HEALTH_READ_TYPES: HealthDataType[] = [
  'heartRate', 'restingHeartRate', 'heartRateVariability', 'sleep', 'steps', 'oxygenSaturation',
  'respiratoryRate', 'bodyTemperature', 'vo2Max', 'activeEnergyBurned', 'bloodPressureSystolic', 'bloodPressureDiastolic',
];
export const HEALTH_WRITE_TYPES: HealthDataType[] = [
  'steps', 'bodyTemperature', 'sleep', 'heartRate', 'heartRateVariability',
  'bloodPressureSystolic', 'bloodPressureDiastolic', 'vo2Max', 'oxygenSaturation', 'activeEnergyBurned',
];
const BACKGROUND_TYPES = [...new Set([...HEALTH_READ_TYPES, ...HEALTH_WRITE_TYPES])];

const ANCHOR_PREFIX = 'healthkit.anchor.';
const SYNC_DEBOUNCE_MS = 1500;
let syncLock = false;
let syncDebounce: ReturnType<typeof setTimeout> | null = null;
let observerListenerBound = false;

export type HealthAuthorizationStatus = 'notDetermined' | 'sharingDenied' | 'sharingAuthorized' | 'unknown';

async function getAuthorizationStatuses(types: HealthDataType[]): Promise<Record<string, HealthAuthorizationStatus>> {
  try {
    const { Health } = await import('@capgo/capacitor-health');
    const checker = (Health as any).checkAuthorization;
    if (typeof checker === 'function') {
      const result = await checker({ types });
      const statuses = result?.statuses ?? {};
      return Object.fromEntries(types.map((type) => [type, statuses[type] ?? 'unknown']));
    }
  } catch {
    // fallback below
  }

  try {
    const result = await VYRHealthBridge.getAuthorizationStatuses({ types });
    return Object.fromEntries(types.map((type) => [type, result.statuses[type] ?? 'unknown']));
  } catch {
    return Object.fromEntries(types.map((type) => [type, 'unknown']));
  }
}

export async function isHealthKitAvailable(): Promise<boolean> {
  try {
    const { Health } = await import('@capgo/capacitor-health');
    const result = await Health.isAvailable();
    return result.available;
  } catch {
    return false;
  }
}

export async function requestHealthKitPermissions(): Promise<boolean> {
  try {
    const { Health } = await import('@capgo/capacitor-health');
    const requestedTypes = [...new Set([...HEALTH_READ_TYPES, ...HEALTH_WRITE_TYPES])];
    const beforeStatus = await getAuthorizationStatuses(requestedTypes);

    await Health.requestAuthorization({ read: HEALTH_READ_TYPES, write: HEALTH_WRITE_TYPES });

    const afterStatus = await getAuthorizationStatuses(requestedTypes);
    const grantedTypes = requestedTypes.filter((type) => afterStatus[type] === 'sharingAuthorized');
    const deniedTypes = requestedTypes.filter((type) => afterStatus[type] === 'sharingDenied' || afterStatus[type] === 'notDetermined');

    console.info('[healthkit] authorization status', { beforeStatus, afterStatus, grantedTypesCount: grantedTypes.length, deniedTypes });

    await forceRefreshSession();
    return grantedTypes.length > 0;
  } catch (e) {
    console.error('[healthkit] Permission request failed:', e);
    await forceRefreshSession();
    return false;
  }
}

export async function writeHealthSample(dataType: HealthDataType, value: number, startDate: string, endDate?: string): Promise<boolean> {
  try {
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

    const { Health } = await import('@capgo/capacitor-health');
    const writer = (Health as any).writeSample ?? (Health as any).writeData;
    if (typeof writer !== 'function') return false;
    await writer({ dataType, value, startDate, endDate: endDate ?? startDate });
    return true;
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

export async function enableHealthKitBackgroundSync(): Promise<void> {
  try {
    for (const type of BACKGROUND_TYPES) {
      await VYRHealthBridge.enableBackgroundDelivery({ type, frequency: 'hourly' });
    }
    await VYRHealthBridge.registerObserverQueries({ types: BACKGROUND_TYPES });

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
    for (const type of BACKGROUND_TYPES) {
      const res = await VYRHealthBridge.readAnchored({ type, anchor: getAnchor(type), limit: 200 });
      if ((res.samples?.length ?? 0) > 0) changed = true;
      setAnchor(type, res.newAnchor);
    }

    if (!changed && trigger === 'observer') return true;
    return await syncHealthKitData();
  } catch (error) {
    console.error('[healthkit] incremental sync failed', error);
    return false;
  } finally {
    syncLock = false;
  }
}

export async function syncHealthKitData(): Promise<boolean> {
  // Debounce / lock
  if (syncLock) {
    console.warn('[healthkit] sync already in progress, skipping');
    return false;
  }
  syncLock = true;

  try {
    const available = await isHealthKitAvailable();
    if (!available) return false;

    const userId = await requireValidUserId();
    const { Health } = await import('@capgo/capacitor-health');
    const now = new Date();
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

    // Update anchors (timestamp-based incremental)
    const nowIso = now.toISOString();
    for (const dt of ['heartRate', 'restingHeartRate', 'heartRateVariability', 'sleep', 'steps', 'oxygenSaturation', 'respiratoryRate']) {
      setLastSyncTimestamp(dt, nowIso);
    }

    return true;
  } catch (e) {
    console.error('[healthkit] sync exception:', e);
    return false;
  } finally {
    syncLock = false;
  }
}
