/**
 * HealthKit integration via @capgo/capacitor-health (Capacitor 8)
 * + VYRHealthBridge for types not covered by the plugin.
 */

import { forceRefreshSession, requireValidUserId, retryOnAuthErrorLabeled } from './auth-session';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { VYRHealthBridge } from './healthkit-bridge';
import type { HealthDataType, HealthSample } from '@capgo/capacitor-health';

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
] as const;

// Types handled exclusively by the Swift bridge for writes
export const BRIDGE_ONLY_WRITE_TYPES = [
  'bodyTemperature', 'vo2Max', 'activeEnergyBurned', 'bloodPressureSystolic', 'bloodPressureDiastolic',
] as const;

// All types for background delivery (plugin + bridge)
const ALL_SYNC_TYPES = [...HEALTH_READ_TYPES, ...BRIDGE_READ_TYPES, ...BRIDGE_ONLY_WRITE_TYPES.filter(t => !BRIDGE_READ_TYPES.includes(t as any))];

const ANCHOR_PREFIX = 'healthkit.anchor.';
const SYNC_DEBOUNCE_MS = 1500;
let syncLock = false;
let syncDebounce: ReturnType<typeof setTimeout> | null = null;
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
    // First check if we already have permissions — skip re-requesting if so
    const allTypes = [...new Set([...HEALTH_READ_TYPES, ...HEALTH_WRITE_TYPES])];
    const currentStatus = await getAuthorizationStatuses([...allTypes, ...BRIDGE_READ_TYPES, ...BRIDGE_ONLY_WRITE_TYPES]);
    const alreadyGranted = Object.entries(currentStatus).filter(([, s]) => s === 'sharingAuthorized').map(([t]) => t);

    if (alreadyGranted.length > 0) {
      console.info('[healthkit] permissions already granted, skipping re-request', { count: alreadyGranted.length });
      await forceRefreshSession();
      return true;
    }

    // First time — request permissions
    const { Health } = await import('@capgo/capacitor-health');

    try {
      await Health.requestAuthorization({ read: HEALTH_READ_TYPES, write: HEALTH_WRITE_TYPES });
    } catch (pluginErr: any) {
      console.warn('[healthkit] @capgo requestAuthorization failed:', pluginErr?.code || pluginErr);
    }

    try {
      await VYRHealthBridge.requestAuthorization({
        readTypes: ['restingHeartRate', 'heartRateVariability', 'oxygenSaturation'],
        writeTypes: ['bodyTemperature', 'vo2Max', 'activeEnergyBurned', 'bloodPressureSystolic', 'bloodPressureDiastolic'],
      });
    } catch (bridgeErr: any) {
      console.warn('[healthkit] bridge requestAuthorization failed:', bridgeErr?.code || bridgeErr);
    }

    const afterStatus = await getAuthorizationStatuses([...allTypes, ...BRIDGE_READ_TYPES, ...BRIDGE_ONLY_WRITE_TYPES]);
    const grantedTypes = Object.entries(afterStatus).filter(([, s]) => s === 'sharingAuthorized').map(([t]) => t);

    console.info('[healthkit] authorization result', { grantedCount: grantedTypes.length });

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

/**
 * Merge overlapping time intervals to avoid double-counting
 * (common with wearables like JCVital that report overlapping blocks).
 */
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

  // Separate awake periods within sleep blocks (to subtract later)
  const awakeSamples = samples.filter((s) => s.sleepState === 'awake');
  const awakeIntervals = mergeIntervals(
    awakeSamples.map((s) => ({ start: new Date(s.startDate).getTime(), end: new Date(s.endDate).getTime() }))
  );
  const totalAwakeMs = awakeIntervals.reduce((sum, i) => sum + (i.end - i.start), 0);

  // Valid sleep samples (excluding awake and inBed)
  const validSamples = samples.filter((s) => s.sleepState && s.sleepState !== 'awake' && s.sleepState !== 'inBed');
  if (validSamples.length === 0) return { durationHours: 0, quality: 0 };

  // Merge overlapping sleep intervals
  const sleepIntervals = mergeIntervals(
    validSamples.map((s) => ({ start: new Date(s.startDate).getTime(), end: new Date(s.endDate).getTime() }))
  );
  const grossSleepMs = sleepIntervals.reduce((sum, i) => sum + (i.end - i.start), 0);
  const netSleepMs = Math.max(0, grossSleepMs - totalAwakeMs);

  if (netSleepMs === 0) return { durationHours: 0, quality: 0 };

  // Calculate stage-specific durations
  let deepMs = 0;
  let remMs = 0;
  let lightMs = 0;
  for (const s of validSamples) {
    const ms = new Date(s.endDate).getTime() - new Date(s.startDate).getTime();
    if (s.sleepState === 'deep') deepMs += ms;
    else if (s.sleepState === 'rem') remMs += ms;
    else lightMs += ms; // light or core
  }

  const stageTotal = deepMs + remMs + lightMs;
  const hasStageBreakdown = stageTotal > 0 && (deepMs > 0 || remMs > 0);

  let quality: number;
  if (hasStageBreakdown) {
    // Primary formula: deep weight 1.0, REM weight 2.5
    quality = Math.min(100, Math.round(((deepMs / stageTotal) + (remMs / stageTotal) * 2.5) * 100));
  } else {
    // Fallback without stage breakdown: duration / 8h * 50
    quality = Math.min(100, Math.round((netSleepMs / (8 * 3600000)) * 50));
  }

  return {
    durationHours: netSleepMs / (1000 * 60 * 60),
    quality,
  };
}

/**
 * Convert HRV (ms) to 0-100 logarithmic scale.
 * 5ms → 0 | 200ms → 100
 */
export function convertHRVtoScale(hrvMs: number): number {
  if (hrvMs <= 0) return 0;
  const clamped = Math.min(200, Math.max(5, hrvMs));
  return Math.min(100, Math.round(
    ((Math.log(clamped) - Math.log(5)) / (Math.log(200) - Math.log(5))) * 100
  ));
}

/**
 * Derive pseudo-HRV (RMSSD) from heart rate samples when wearable
 * doesn't send HRV to Health Connect but has HR data.
 *
 * Requirements:
 * - Minimum 10 HR samples
 * - Average spacing between samples ≤ 5 minutes
 * - HR values between 30-220 bpm
 *
 * Returns RMSSD in ms, or undefined if requirements not met.
 */
export function derivePseudoHRV(hrSamples: HealthSample[]): number | undefined {
  // Filter to valid HR range
  const filtered = hrSamples
    .filter((s) => s.value >= 30 && s.value <= 220)
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

  if (filtered.length < 10) return undefined;

  // Check average spacing ≤ 5 minutes
  let totalSpacing = 0;
  for (let i = 1; i < filtered.length; i++) {
    totalSpacing += new Date(filtered[i].startDate).getTime() - new Date(filtered[i - 1].startDate).getTime();
  }
  const avgSpacingMs = totalSpacing / (filtered.length - 1);
  if (avgSpacingMs > 5 * 60 * 1000) return undefined;

  // Convert BPM → RR intervals (ms)
  const rrIntervals = filtered.map((s) => 60000 / s.value);

  // Calculate RMSSD (root mean square of successive differences)
  let sumSqDiff = 0;
  for (let i = 1; i < rrIntervals.length; i++) {
    const diff = rrIntervals[i] - rrIntervals[i - 1];
    sumSqDiff += diff * diff;
  }
  const rmssd = Math.sqrt(sumSqDiff / (rrIntervals.length - 1));

  return rmssd;
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

/**
 * Compute stress level (0-100) using z-score over ln(RMSSD).
 *
 * Falls back to 50 (neutral) if no HRV data available.
 * Applies contextual modifiers for RHR, sleep deficit, and respiratory rate.
 */
export function computeStressLevel(avgHrv: number | undefined, ctx?: StressContext): number {
  if (avgHrv == null) return 50;

  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

  // Z-score over ln(RMSSD)
  const lnHrv = Math.log(clamp(avgHrv, 5, 250));
  const mean = Math.log(40); // ≈ 3.689 (population baseline)
  const std = 0.4;
  const z = clamp((lnHrv - mean) / std, -3, 3);

  // Base stress: z=-3 → 100 (max stress), z=0 → 50, z=+3 → 0
  let stress = ((-z + 3) / 6) * 100;

  // Contextual modifiers (sum up to +33)
  if (ctx) {
    const blRhrMean = ctx.baseline?.rhr?.mean ?? 65;
    const blSleepMean = ctx.baseline?.sleep?.mean ?? 7;

    // Resting HR modifier: delta > 3 bpm above baseline → +up to 15
    if (ctx.avgRhr != null) {
      const delta = ctx.avgRhr - blRhrMean;
      if (delta > 3) {
        stress += clamp((delta - 3) * 2, 0, 15);
      }
    }

    // Sleep deficit modifier: deficit > 0.5h → +up to 10
    if (ctx.sleepHours != null) {
      const deficit = blSleepMean - ctx.sleepHours;
      if (deficit > 0.5) {
        stress += clamp(deficit * 4, 0, 10);
      }
    }

    // Respiratory rate modifier: RR > 18 → +up to 8
    if (ctx.avgRespiratoryRate != null && ctx.avgRespiratoryRate > 18) {
      stress += clamp((ctx.avgRespiratoryRate - 18) * 1.5, 0, 8);
    }
  }

  return Math.round(clamp(stress, 0, 100));
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
  const isNative = !!(window as any).Capacitor?.isNativePlatform?.();
  if (!isNative) {
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
    // Only read bridge-supported types (not plugin-only or write-only types)
    for (const type of BRIDGE_READ_TYPES) {
      try {
        const res = await VYRHealthBridge.readAnchored({ type: String(type), anchor: getAnchor(String(type)), limit: 200 });
        if ((res.samples?.length ?? 0) > 0) changed = true;
        setAnchor(String(type), res.newAnchor);
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

  // Read ALL types with time window (24h) — do NOT use stored anchors here,
  // as runIncrementalHealthSync may have already consumed them.
  // readAnchored without anchor reads all available data; we pass no anchor
  // to get a full read, then the time window is handled by the predicate
  // in the @capgo plugin. For bridge types, we read without anchor to get
  // everything, then filter by time window in JS.
  const [sleepData, stepsData, hrData, rhrBridge, hrvBridge, spo2Bridge] = await Promise.all([
    Health.readSamples({ ...queryOpts, dataType: 'sleep' }).catch(() => empty),
    Health.readSamples({ ...queryOpts, dataType: 'steps' }).catch(() => empty),
    Health.readSamples({ ...queryOpts, dataType: 'heartRate' }).catch(() => empty),
    // Bridge: read WITHOUT anchor to get all data, not just delta
    VYRHealthBridge.readAnchored({ type: 'restingHeartRate', limit: 500 }).catch(() => emptyBridge),
    VYRHealthBridge.readAnchored({ type: 'heartRateVariability', limit: 500 }).catch(() => emptyBridge),
    VYRHealthBridge.readAnchored({ type: 'oxygenSaturation', limit: 500 }).catch(() => emptyBridge),
  ]);

  // Filter bridge samples to last 24h (readAnchored has no time predicate)
  const cutoff = yesterday.toISOString();
  const filterByTime = (samples: Array<Record<string, unknown>>) =>
    samples.filter(s => String(s.startDate || '') >= cutoff);

  rhrBridge.samples = filterByTime(rhrBridge.samples);
  hrvBridge.samples = filterByTime(hrvBridge.samples);
  spo2Bridge.samples = filterByTime(spo2Bridge.samples);

  console.info('[healthkit] sync samples count', {
    sleep: sleepData.samples.length,
    steps: stepsData.samples.length,
    hr: hrData.samples.length,
    rhr: rhrBridge.samples.length,
    hrv: hrvBridge.samples.length,
    spo2: spo2Bridge.samples.length,
  });

  // ── Persist raw biomarker samples (never overwritten, deduped by constraint) ──
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

  // Bridge samples: value is a number from serialize()
  const bridgeAvg = (samples: Array<Record<string, unknown>>): number | undefined => {
    const vals = samples.map(s => Number(s.value)).filter(v => !isNaN(v) && v > 0);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : undefined;
  };

  // Heart rate average from @capgo samples
  const hrVals = hrData.samples.map(s => s.value).filter(v => !isNaN(v) && v > 0);
  const avgHr = hrVals.length > 0 ? hrVals.reduce((a, b) => a + b, 0) / hrVals.length : undefined;

  const avgRhr = bridgeAvg(rhrBridge.samples);
  const realHrv = bridgeAvg(hrvBridge.samples);
  const avgSpo2 = bridgeAvg(spo2Bridge.samples);

  // Use real HRV from Health Connect, or derive pseudo-HRV from HR samples
  const avgHrv = realHrv ?? derivePseudoHRV(hrData.samples);

  // Derive RHR fallback: average of lowest 20% HR samples
  let computedRhr = avgRhr;
  if (computedRhr == null && hrVals.length > 0) {
    const sorted = [...hrVals].sort((a, b) => a - b);
    const bottom20 = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.2)));
    computedRhr = bottom20.reduce((a, b) => a + b, 0) / bottom20.length;
  }

  // Compute stress with contextual modifiers
  const stressLevel = computeStressLevel(avgHrv, {
    avgRhr: computedRhr,
    sleepHours: durationHours,
  });

  const metrics = {
    hr_avg: avgHr ? Math.round(avgHr) : null,
    rhr: computedRhr ? Math.round(computedRhr) : null,
    hrv_sdnn: avgHrv ? Math.round(avgHrv * 10) / 10 : null,
    hrv_index: avgHrv ? convertHRVtoScale(avgHrv) : null,
    stress_level: stressLevel,
    sleep_duration_hours: Math.round(durationHours * 10) / 10,
    sleep_quality: sleepQuality,
    steps: totalSteps,
    spo2: avgSpo2 ? Math.round(avgSpo2 * 10) / 10 : null,
  };

  const result = await retryOnAuthErrorLabeled(async () => {
    const res = await supabase.from('ring_daily_data').upsert([{ user_id: userId, day: today, source_provider: 'apple_health', metrics: metrics as unknown as Json }], { onConflict: 'user_id,day,source_provider' }).select();
    return { data: res.data, error: res.error ? { code: (res.error as any).code, message: res.error.message } : null };
  }, { table: 'ring_daily_data', operation: 'upsert' });

  if (result.error) return false;

  await retryOnAuthErrorLabeled(async () => {
    const res = await supabase.from('user_integrations').upsert([{ user_id: userId, provider: 'apple_health', status: 'active', last_sync_at: new Date().toISOString() }], { onConflict: 'user_id,provider' }).select();
    return { data: res.data, error: res.error ? { code: (res.error as any).code, message: res.error.message } : null };
  }, { table: 'user_integrations', operation: 'upsert' });

  const nowIso = now.toISOString();
  for (const dt of [...HEALTH_READ_TYPES, ...BRIDGE_READ_TYPES]) {
    setLastSyncTimestamp(dt, nowIso);
  }

  return true;
}
