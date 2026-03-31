/**
 * HealthKit integration via @capgo/capacitor-health (Capacitor 8)
 * + VYRHealthBridge for types not covered by the plugin.
 *
 * FIXES APPLIED:
 * P1 — Anchors and connection state persisted in UserDefaults (via native bridge),
 *       not localStorage. Survives TestFlight public link reinstalls.
 * P3 — probeHealthKitRead() now validates actual authorization status, not just
 *       absence of exception from readSamples().
 * P5 — observerListenerBound replaced with native-side idempotent registration.
 */

import { forceRefreshSession, requireValidUserId, retryOnAuthErrorLabeled } from './auth-session';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { VYRHealthBridge } from './healthkit-bridge';
import type { HealthDataType, HealthSample } from '@capgo/capacitor-health';
import { computeAndStoreState } from './vyr-recompute';
import { computeStressLevelV4 } from './vyr-stress';
import { computeStateViaEdge } from './vyr-compute-client';

// Types the @capgo/capacitor-health plugin actually supports
export const HEALTH_READ_TYPES: HealthDataType[] = [
  'heartRate', 'sleep', 'steps',
];
export const HEALTH_WRITE_TYPES: HealthDataType[] = [
  'steps', 'heartRate', 'sleep',
];

// Types read via VYRHealthBridge.readAnchored (not supported by @capgo plugin)
export const BRIDGE_READ_TYPES = [
  'restingHeartRate', 'heartRateVariability', 'oxygenSaturation',
  'respiratoryRate', 'vo2Max', 'skinTemperature',
  'activeEnergyBurned', 'basalEnergyBurned',
  'walkingHeartRateAverage', 'heartRateRecovery',
] as const;

// Types handled exclusively by the Swift bridge for writes
export const BRIDGE_ONLY_WRITE_TYPES = [
  'bodyTemperature', 'bloodPressureSystolic', 'bloodPressureDiastolic',
] as const;

// All types for background delivery (plugin + bridge)
const ALL_SYNC_TYPES = [...HEALTH_READ_TYPES, ...BRIDGE_READ_TYPES, ...BRIDGE_ONLY_WRITE_TYPES.filter(t => !BRIDGE_READ_TYPES.includes(t as any))];

const SYNC_DEBOUNCE_MS = 1500;
let syncLock = false;
let syncDebounce: ReturnType<typeof setTimeout> | null = null;

// FIX P5: observerListenerBound removed — native side now handles idempotency.
// JS-side listener is re-registered on every enableHealthKitBackgroundSync() call
// with a guard that prevents duplicate event forwarding.
let observerListenersActive = false;

/**
 * Downsample samples to max 1 per minute.
 * Groups by minute-floor of startDate, keeps the first sample in each bucket.
 */
function downsampleToOnePerMinute<T extends { startDate: string }>(samples: T[]): T[] {
  const buckets = new Map<number, T>();
  for (const s of samples) {
    const minuteKey = Math.floor(new Date(s.startDate).getTime() / 60000);
    if (!buckets.has(minuteKey)) buckets.set(minuteKey, s);
  }
  return Array.from(buckets.values());
}

/**
 * Build rows for biomarker_samples table from raw provider data.
 */
function buildSampleRows(
  userId: string,
  hrSamples: HealthSample[],
  rhrSamples: Array<Record<string, unknown>>,
  hrvSamples: Array<Record<string, unknown>>,
  spo2Samples: Array<Record<string, unknown>>,
  stepsSamples: HealthSample[],
  sleepSamples: HealthSample[],
): Array<{
  user_id: string; type: string; ts: string; end_ts: string | null;
  value: number | null; payload_json: Record<string, unknown> | null; source: string;
}> {
  const rows: ReturnType<typeof buildSampleRows> = [];
  const src = 'apple_health';

  // HR — downsampled to 1/min
  for (const s of downsampleToOnePerMinute(hrSamples)) {
    rows.push({ user_id: userId, type: 'hr', ts: s.startDate, end_ts: null, value: s.value, payload_json: null, source: src });
  }
  // RHR
  for (const s of rhrSamples) {
    rows.push({ user_id: userId, type: 'rhr', ts: String(s.startDate), end_ts: null, value: Number(s.value), payload_json: null, source: src });
  }
  // HRV
  for (const s of hrvSamples) {
    rows.push({ user_id: userId, type: 'hrv', ts: String(s.startDate), end_ts: null, value: Number(s.value), payload_json: null, source: src });
  }
  // SpO2
  for (const s of spo2Samples) {
    rows.push({ user_id: userId, type: 'spo2', ts: String(s.startDate), end_ts: null, value: Number(s.value), payload_json: null, source: src });
  }
  // Steps (have start + end)
  for (const s of stepsSamples) {
    rows.push({ user_id: userId, type: 'steps', ts: s.startDate, end_ts: s.endDate, value: s.value, payload_json: null, source: src });
  }
  // Sleep (each stage with metadata)
  for (const s of sleepSamples) {
    rows.push({
      user_id: userId, type: 'sleep', ts: s.startDate, end_ts: s.endDate,
      value: null, payload_json: s.sleepState ? { sleepState: s.sleepState } : null, source: src,
    });
  }
  return rows;
}

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
    const isNative = !!(window as any).Capacitor?.isNativePlatform?.();
    console.log('[healthkit] isNativePlatform fallback:', isNative);
    return isNative;
  }
}

export async function requestHealthKitPermissions(): Promise<boolean> {
  try {
    // FIX P3: Check actual authorization status first — not just a probe read.
    // probeHealthKitRead() was returning true on empty reads (no exception = assumed granted).
    const allTypes = [...new Set([...HEALTH_READ_TYPES, ...HEALTH_WRITE_TYPES])] as string[];
    const bridgeTypes = [...BRIDGE_READ_TYPES, ...BRIDGE_ONLY_WRITE_TYPES] as string[];
    const currentStatus = await getAuthorizationStatuses([...allTypes, ...bridgeTypes]);

    const alreadyGranted = Object.entries(currentStatus)
      .filter(([, s]) => s === 'sharingAuthorized')
      .map(([t]) => t);

    if (alreadyGranted.length >= 3) {
      // At least 3 types explicitly authorized — skip re-requesting
      console.info('[healthkit] permissions already granted via status check', { count: alreadyGranted.length });
      try { await forceRefreshSession(); } catch { /* non-fatal */ }
      return true;
    }

    // Request permissions via @capgo plugin
    const { Health } = await import('@capgo/capacitor-health');
    let pluginOk = false;
    try {
      await Health.requestAuthorization({ read: HEALTH_READ_TYPES, write: HEALTH_WRITE_TYPES });
      pluginOk = true;
    } catch (pluginErr: any) {
      console.warn('[healthkit] @capgo requestAuthorization failed:', pluginErr?.code || pluginErr);
    }

    // Request permissions via bridge for additional types
    let bridgeOk = false;
    try {
      const bridgeResult = await VYRHealthBridge.requestAuthorization({
        readTypes: [...BRIDGE_READ_TYPES] as string[],
        writeTypes: [...BRIDGE_ONLY_WRITE_TYPES] as string[],
      });
      bridgeOk = bridgeResult?.granted ?? false;
    } catch (bridgeErr: any) {
      console.warn('[healthkit] bridge requestAuthorization failed:', bridgeErr?.code || bridgeErr);
    }

    try { await forceRefreshSession(); } catch { /* non-fatal — P2 fix: don't sign out */ }

    if (pluginOk || bridgeOk) {
      console.info('[healthkit] authorization dialog completed', { pluginOk, bridgeOk });

      // FIX P3: Verify with an actual status check, not a probe read
      const afterStatus = await getAuthorizationStatuses([...allTypes, ...bridgeTypes]);
      const grantedAfter = Object.entries(afterStatus)
        .filter(([, s]) => s === 'sharingAuthorized')
        .map(([t]) => t);

      if (grantedAfter.length > 0) {
        console.info('[healthkit] post-authorization status verified', { count: grantedAfter.length });
        return true;
      }

      // Dialog was shown but status still notDetermined — iOS privacy quirk.
      // Trust that the dialog completed without error.
      console.info('[healthkit] post-authorization status pending — trusting dialog completion');
      return true;
    }

    // Both failed — check status as final fallback
    const fallbackStatus = await getAuthorizationStatuses([...allTypes, ...bridgeTypes]);
    const fallbackGranted = Object.entries(fallbackStatus)
      .filter(([, s]) => s === 'sharingAuthorized' || s === 'unknown')
      .map(([t]) => t);

    console.info('[healthkit] authorization fallback status check', { grantedCount: fallbackGranted.length });
    return fallbackGranted.length > 0;
  } catch (e) {
    console.error('[healthkit] Permission request failed:', e);
    try { await forceRefreshSession(); } catch { /* non-fatal */ }
    return false;
  }
}

/**
 * Silently check if HealthKit permissions are granted without showing a dialog.
 * Exported for vyr-collector.ts compatibility with Android interface.
 * Uses actual authorization status check (P3 approach).
 */
export async function checkHealthKitPermissions(): Promise<boolean> {
  const isNative = !!(window as any).Capacitor?.isNativePlatform?.();
  if (!isNative) return false;
  try {
    const allTypes = [...new Set([...HEALTH_READ_TYPES, ...HEALTH_WRITE_TYPES])] as string[];
    const statuses = await getAuthorizationStatuses(allTypes);
    return Object.values(statuses).some(s => s === 'sharingAuthorized');
  } catch {
    return false;
  }
}

export async function writeHealthSample(dataType: string, value: number, startDate: string, endDate?: string): Promise<boolean> {
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

/**
 * FIX P1: Anchor persistence via UserDefaults (native) instead of localStorage.
 * Falls back to localStorage on web/non-native for dev compatibility.
 */
const isNativePlatform = (): boolean =>
  !!(window as any).Capacitor?.isNativePlatform?.();

async function getAnchor(type: string): Promise<string | undefined> {
  if (isNativePlatform()) {
    try {
      const result = await VYRHealthBridge.loadAnchor({ key: type });
      return result.value ?? undefined;
    } catch {
      // Fallback to localStorage if bridge call fails (shouldn't happen on native)
    }
  }
  return localStorage.getItem(`healthkit.anchor.${type}`) ?? undefined;
}

async function setAnchor(type: string, anchor?: string): Promise<void> {
  if (!anchor) return;
  if (isNativePlatform()) {
    try {
      await VYRHealthBridge.saveAnchor({ key: type, value: anchor });
      return;
    } catch {
      // Fallback
    }
  }
  localStorage.setItem(`healthkit.anchor.${type}`, anchor);
}

function setLastSyncTimestamp(type: string, iso: string): void {
  localStorage.setItem(`healthkit.anchor.ts.${type}`, iso);
}

export async function enableHealthKitBackgroundSync(): Promise<void> {
  try {
    for (const type of ALL_SYNC_TYPES) {
      await VYRHealthBridge.enableBackgroundDelivery({ type: String(type), frequency: 'hourly' });
    }
    // FIX P5: registerObserverQueries is now idempotent on the native side —
    // it only adds missing keys, won't duplicate. Safe to call on every resume.
    await VYRHealthBridge.registerObserverQueries({ types: ALL_SYNC_TYPES.map(String) });

    // JS-side listener: only bind once per JS context lifetime
    if (!observerListenersActive) {
      observerListenersActive = true;
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
  if (!isNativePlatform()) {
    console.warn('[healthkit] skipping sync on web platform');
    return false;
  }
  if (syncLock) return false;

  if (syncDebounce) clearTimeout(syncDebounce);
  await new Promise<void>((resolve) => {
    syncDebounce = setTimeout(() => resolve(), SYNC_DEBOUNCE_MS);
  });

  syncLock = true;
  try {
    let changed = false;
    for (const type of BRIDGE_READ_TYPES) {
      try {
        // FIX P1: getAnchor now reads from UserDefaults via native bridge
        const storedAnchor = await getAnchor(String(type));
        const res = await VYRHealthBridge.readAnchored({ type: String(type), anchor: storedAnchor, limit: 200 });
        if ((res.samples?.length ?? 0) > 0) changed = true;
        // FIX P1: native bridge auto-saves the anchor in readAnchored() — setAnchor is
        // called here for JS/web fallback compatibility only
        await setAnchor(String(type), res.newAnchor);
      } catch (e) {
        console.warn(`[healthkit] readAnchored skipped for ${type}:`, e);
      }
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
  const emptyBridge = { samples: [] as Array<Record<string, unknown>> };

  const [
    sleepData, stepsData, hrData,
    rhrBridge, hrvBridge, spo2Bridge, rrBridge,
    vo2MaxBridge, skinTempBridge,
    activeEnergyBridge, basalEnergyBridge,
    walkingHrBridge, hrRecoveryBridge,
  ] = await Promise.all([
    Health.readSamples({ ...queryOpts, dataType: 'sleep' }).catch(() => empty),
    Health.readSamples({ ...queryOpts, dataType: 'steps' }).catch(() => empty),
    Health.readSamples({ ...queryOpts, dataType: 'heartRate' }).catch(() => empty),
    VYRHealthBridge.readAnchored({ type: 'restingHeartRate', limit: 500 }).catch(() => emptyBridge),
    VYRHealthBridge.readAnchored({ type: 'heartRateVariability', limit: 500 }).catch(() => emptyBridge),
    VYRHealthBridge.readAnchored({ type: 'oxygenSaturation', limit: 500 }).catch(() => emptyBridge),
    VYRHealthBridge.readAnchored({ type: 'respiratoryRate', limit: 500 }).catch(() => emptyBridge),
    VYRHealthBridge.readAnchored({ type: 'vo2Max', limit: 100 }).catch(() => emptyBridge),
    VYRHealthBridge.readAnchored({ type: 'skinTemperature', limit: 100 }).catch(() => emptyBridge),
    VYRHealthBridge.readAnchored({ type: 'activeEnergyBurned', limit: 500 }).catch(() => emptyBridge),
    VYRHealthBridge.readAnchored({ type: 'basalEnergyBurned', limit: 100 }).catch(() => emptyBridge),
    VYRHealthBridge.readAnchored({ type: 'walkingHeartRateAverage', limit: 100 }).catch(() => emptyBridge),
    VYRHealthBridge.readAnchored({ type: 'heartRateRecovery', limit: 100 }).catch(() => emptyBridge),
  ]);

  const cutoff = yesterday.toISOString();
  const filterByTime = (samples: Array<Record<string, unknown>>) =>
    samples.filter(s => String(s.startDate || '') >= cutoff);

  rhrBridge.samples     = filterByTime(rhrBridge.samples);
  hrvBridge.samples     = filterByTime(hrvBridge.samples);
  spo2Bridge.samples    = filterByTime(spo2Bridge.samples);
  rrBridge.samples      = filterByTime(rrBridge.samples);
  vo2MaxBridge.samples  = filterByTime(vo2MaxBridge.samples);
  skinTempBridge.samples       = filterByTime(skinTempBridge.samples);
  activeEnergyBridge.samples   = filterByTime(activeEnergyBridge.samples);
  basalEnergyBridge.samples    = filterByTime(basalEnergyBridge.samples);
  walkingHrBridge.samples      = filterByTime(walkingHrBridge.samples);
  hrRecoveryBridge.samples     = filterByTime(hrRecoveryBridge.samples);

  console.info('[healthkit] sync samples count', {
    sleep: sleepData.samples.length,
    steps: stepsData.samples.length,
    hr: hrData.samples.length,
    rhr: rhrBridge.samples.length,
    hrv: hrvBridge.samples.length,
    spo2: spo2Bridge.samples.length,
  });

  const rawRows = buildSampleRows(
    userId,
    hrData.samples, rhrBridge.samples, hrvBridge.samples, spo2Bridge.samples,
    stepsData.samples, sleepData.samples,
  );
  if (rawRows.length > 0) {
    try {
      const { error: rawErr } = await supabase
        .from('biomarker_samples')
        .insert(rawRows as any)
        .select('id');
      if (rawErr && (rawErr as any).code !== '23505') {
        console.warn('[healthkit] biomarker_samples insert error:', rawErr.message);
      }
      console.info('[healthkit] raw samples persisted:', rawRows.length, 'rows (deduped silently)');
    } catch (e) {
      console.warn('[healthkit] biomarker_samples insert failed:', e);
    }
  }

  const { durationHours, quality: sleepQuality } = calculateSleepQuality(sleepData.samples);
  const totalSteps = stepsData.samples.reduce((sum: number, s) => sum + s.value, 0);

  const bridgeAvg = (samples: Array<Record<string, unknown>>): number | undefined => {
    const vals = samples.map(s => Number(s.value)).filter(v => !isNaN(v) && v > 0);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : undefined;
  };

  const hrVals = hrData.samples.map(s => s.value).filter(v => !isNaN(v) && v > 0);
  const avgHr = hrVals.length > 0 ? hrVals.reduce((a, b) => a + b, 0) / hrVals.length : undefined;

  const avgRhr = bridgeAvg(rhrBridge.samples);
  const realHrv = bridgeAvg(hrvBridge.samples);
  const avgSpo2 = bridgeAvg(spo2Bridge.samples);
  const avgRR   = bridgeAvg(rrBridge.samples);

  // F1b extended metrics
  const avgVo2Max          = bridgeAvg(vo2MaxBridge.samples);
  const avgBasalEnergyKcal = bridgeAvg(basalEnergyBridge.samples);
  const avgWalkingHr       = bridgeAvg(walkingHrBridge.samples);
  const avgHrRecovery1Min  = bridgeAvg(hrRecoveryBridge.samples);
  const activeEnergyKcal   = activeEnergyBridge.samples.length > 0
    ? activeEnergyBridge.samples.reduce((sum, s) => sum + Number(s.value || 0), 0)
    : undefined;
  const latestSkinTemp = skinTempBridge.samples.length > 0
    ? Number(skinTempBridge.samples[skinTempBridge.samples.length - 1].value ?? 0)
    : undefined;

  // HRV: marca se é real (wearable) ou derivado de FC
  const pseudoHrv = derivePseudoHRV(hrData.samples);
  const avgHrv = realHrv ?? pseudoHrv;
  const hrvIsReal = realHrv != null;

  let computedRhr = avgRhr;
  if (computedRhr == null && hrVals.length > 0) {
    const sorted = [...hrVals].sort((a, b) => a - b);
    const bottom20 = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.2)));
    computedRhr = bottom20.reduce((a, b) => a + b, 0) / bottom20.length;
  }

  // Stress cascade: HRV real → HRV derivado de FC → RHR+sono+RR → fallback 50
  const stressLevel = computeStressLevelV4(avgHrv, {
    avgRhr: computedRhr,
    sleepHours: durationHours,
    sleepQuality: sleepQuality || undefined,
    avgRespiratoryRate: avgRR,
    skinTempDelta: latestSkinTemp ?? undefined,
    hrvIsReal,
  });

  const metrics = {
    hr_avg: avgHr ? Math.round(avgHr) : null,
    rhr: computedRhr ? Math.round(computedRhr) : null,
    hrv_sdnn: avgHrv ? Math.round(avgHrv * 10) / 10 : null,
    hrv_rmssd: !hrvIsReal && avgHrv ? Math.round(avgHrv * 10) / 10 : null,
    hrv_index: avgHrv ? convertHRVtoScale(avgHrv) : null,
    hrv_type: avgHrv ? (hrvIsReal ? 'sdnn' as const : 'rmssd_derived' as const) : null,
    hrv_source: avgHrv ? (hrvIsReal ? 'wearable' as const : 'derived_from_hr' as const) : null,
    stress_level: stressLevel,
    sleep_duration_hours: Math.round(durationHours * 10) / 10,
    sleep_quality: sleepQuality,
    steps: totalSteps,
    spo2: avgSpo2 ? Math.round(avgSpo2 * 10) / 10 : null,
    // F1b extended biomarkers
    respiratory_rate: avgRR ? Math.round(avgRR * 10) / 10 : null,
    vo2_max: avgVo2Max ? Math.round(avgVo2Max * 10) / 10 : null,
    skin_temp_delta: latestSkinTemp != null ? Math.round(latestSkinTemp * 100) / 100 : null,
    active_energy_kcal: activeEnergyKcal ? Math.round(activeEnergyKcal) : null,
    basal_energy_kcal: avgBasalEnergyKcal ? Math.round(avgBasalEnergyKcal) : null,
    walking_hr_avg: avgWalkingHr ? Math.round(avgWalkingHr * 10) / 10 : null,
    hr_recovery_1min: avgHrRecovery1Min ? Math.round(avgHrRecovery1Min * 10) / 10 : null,
  };

  const result = await retryOnAuthErrorLabeled(async () => {
    const res = await supabase.from('ring_daily_data').upsert(
      [{ user_id: userId, day: today, source_provider: 'apple_health', metrics: metrics as unknown as Json }],
      { onConflict: 'user_id,day,source_provider' }
    ).select();
    return { data: res.data, error: res.error ? { code: (res.error as any).code, message: res.error.message } : null };
  }, { table: 'ring_daily_data', operation: 'upsert' });

  if (result.error) return false;

  await retryOnAuthErrorLabeled(async () => {
    const res = await supabase.from('user_integrations').upsert(
      [{ user_id: userId, provider: 'apple_health', status: 'active', last_sync_at: new Date().toISOString() }],
      { onConflict: 'user_id,provider' }
    ).select();
    return { data: res.data, error: res.error ? { code: (res.error as any).code, message: res.error.message } : null };
  }, { table: 'user_integrations', operation: 'upsert' });

  const nowIso = now.toISOString();
  for (const dt of [...HEALTH_READ_TYPES, ...BRIDGE_READ_TYPES]) {
    setLastSyncTimestamp(dt, nowIso);
  }

  // F5b: Edge Function v4 server-side compute + local fallback
  try {
    const edgeResult = await computeStateViaEdge(today);
    if (!edgeResult) {
      await computeAndStoreState(today, userId);
    }
  } catch (e) {
    console.warn('[healthkit] post-sync compute failed:', e);
  }

  return true;
}

// ─── Utility functions (unchanged) ──────────────────────────────────────────

function mergeIntervals(intervals: { start: number; end: number }[]): { start: number; end: number }[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end) {
      last.end = Math.max(last.end, sorted[i].end);
    } else {
      merged.push(sorted[i]);
    }
  }
  return merged;
}

export function calculateSleepQuality(samples: HealthSample[]): { durationHours: number; quality: number } {
  if (samples.length === 0) return { durationHours: 0, quality: 0 };

  const awakeSamples = samples.filter((s) => s.sleepState === 'awake');
  const awakeIntervals = mergeIntervals(
    awakeSamples.map((s) => ({ start: new Date(s.startDate).getTime(), end: new Date(s.endDate).getTime() }))
  );
  const totalAwakeMs = awakeIntervals.reduce((sum, i) => sum + (i.end - i.start), 0);

  const validSamples = samples.filter((s) => s.sleepState && s.sleepState !== 'awake' && s.sleepState !== 'inBed');
  if (validSamples.length === 0) return { durationHours: 0, quality: 0 };

  const sleepIntervals = mergeIntervals(
    validSamples.map((s) => ({ start: new Date(s.startDate).getTime(), end: new Date(s.endDate).getTime() }))
  );
  const grossSleepMs = sleepIntervals.reduce((sum, i) => sum + (i.end - i.start), 0);
  const netSleepMs = Math.max(0, grossSleepMs - totalAwakeMs);

  if (netSleepMs === 0) return { durationHours: 0, quality: 0 };

  let deepMs = 0, remMs = 0, lightMs = 0;
  for (const s of validSamples) {
    const ms = new Date(s.endDate).getTime() - new Date(s.startDate).getTime();
    if (s.sleepState === 'deep') deepMs += ms;
    else if (s.sleepState === 'rem') remMs += ms;
    else lightMs += ms;
  }

  const stageTotal = deepMs + remMs + lightMs;
  const hasStageBreakdown = stageTotal > 0 && (deepMs > 0 || remMs > 0);

  let quality: number;
  if (hasStageBreakdown) {
    quality = Math.min(100, Math.round(((deepMs / stageTotal) + (remMs / stageTotal) * 2.5) * 100));
  } else {
    quality = Math.min(100, Math.round((netSleepMs / (8 * 3600000)) * 50));
  }

  return { durationHours: netSleepMs / (1000 * 60 * 60), quality };
}

export function convertHRVtoScale(hrvMs: number): number {
  if (hrvMs <= 0) return 0;
  const clamped = Math.min(200, Math.max(5, hrvMs));
  return Math.min(100, Math.round(
    ((Math.log(clamped) - Math.log(5)) / (Math.log(200) - Math.log(5))) * 100
  ));
}

export function derivePseudoHRV(hrSamples: HealthSample[]): number | undefined {
  const filtered = hrSamples
    .filter((s) => s.value >= 30 && s.value <= 220)
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

  if (filtered.length < 10) return undefined;

  let totalSpacing = 0;
  for (let i = 1; i < filtered.length; i++) {
    totalSpacing += new Date(filtered[i].startDate).getTime() - new Date(filtered[i - 1].startDate).getTime();
  }
  if (totalSpacing / (filtered.length - 1) > 5 * 60 * 1000) return undefined;

  const rrIntervals = filtered.map((s) => 60000 / s.value);
  let sumSqDiff = 0;
  for (let i = 1; i < rrIntervals.length; i++) {
    const diff = rrIntervals[i] - rrIntervals[i - 1];
    sumSqDiff += diff * diff;
  }
  return Math.sqrt(sumSqDiff / (rrIntervals.length - 1));
}

export interface StressContext {
  avgRhr?: number;
  sleepHours?: number;
  avgRespiratoryRate?: number;
  baseline?: {
    rhr?: { mean: number };
    sleep?: { mean: number };
  };
}

export function computeStressLevel(avgHrv: number | undefined, ctx?: StressContext): number {
  if (avgHrv == null) return 50;
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  const lnHrv = Math.log(clamp(avgHrv, 5, 250));
  const mean = Math.log(40);
  const std = 0.4;
  const z = clamp((lnHrv - mean) / std, -3, 3);
  let stress = ((-z + 3) / 6) * 100;

  if (ctx) {
    const blRhrMean = ctx.baseline?.rhr?.mean ?? 65;
    const blSleepMean = ctx.baseline?.sleep?.mean ?? 7;
    if (ctx.avgRhr != null) {
      const delta = ctx.avgRhr - blRhrMean;
      if (delta > 3) stress += clamp((delta - 3) * 2, 0, 15);
    }
    if (ctx.sleepHours != null) {
      const deficit = blSleepMean - ctx.sleepHours;
      if (deficit > 0.5) stress += clamp(deficit * 4, 0, 10);
    }
    if (ctx.avgRespiratoryRate != null && ctx.avgRespiratoryRate > 18) {
      stress += clamp((ctx.avgRespiratoryRate - 18) * 1.5, 0, 8);
    }
  }

  return Math.round(clamp(stress, 0, 100));
}
