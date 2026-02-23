/**
 * HealthKit integration via @capgo/capacitor-health (Capacitor 8)
 * This module is a no-op on web — only functional in iOS native context.
 */

import { forceRefreshSession, requireValidUserId, retryOnAuthErrorLabeled } from './auth-session';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import type { HealthDataType, HealthSample } from '@capgo/capacitor-health';

const HEALTH_READ_TYPES: HealthDataType[] = [
  'heartRate',
  'restingHeartRate',
  'heartRateVariability',
  'sleep',
  'steps',
  'oxygenSaturation',
  'respiratoryRate',
];

// Types for sleep processing
export interface SleepSampleProcessed {
  sleepState: string;
  startDate: string;
  endDate: string;
  value: number;
}

/**
 * Check if HealthKit is available (iOS only)
 */
export async function isHealthKitAvailable(): Promise<boolean> {
  try {
    const { Health } = await import('@capgo/capacitor-health');
    const result = await Health.isAvailable();
    return result.available;
  } catch {
    return false;
  }
}

/**
 * Request HealthKit read permissions
 */
export async function requestHealthKitPermissions(): Promise<boolean> {
  try {
    const { Health } = await import('@capgo/capacitor-health');
    await Health.requestAuthorization({
      read: HEALTH_READ_TYPES,
      write: [],
    });
    // CRITICAL: Force session refresh after native dialog
    await forceRefreshSession();
    return true;
  } catch (e) {
    console.error('[healthkit] Permission request failed:', e);
    await forceRefreshSession();
    return false;
  }
}

/**
 * Calculate sleep quality from sleep samples
 * Formula: quality = (% deep + REM × 2.5)
 * Excludes awake and inBed samples
 */
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

/**
 * Convert HRV (SDNN in ms) to a 0-100 scale using logarithmic transformation
 */
export function convertHRVtoScale(hrvMs: number): number {
  if (hrvMs <= 0) return 0;
  return Math.min(100, Math.round((Math.log(hrvMs) / Math.log(200)) * 100));
}

/**
 * Sync HealthKit data to Supabase
 */
export async function syncHealthKitData(): Promise<boolean> {
  try {
    const available = await isHealthKitAvailable();
    if (!available) return false;

    const userId = await requireValidUserId();
    const { Health } = await import('@capgo/capacitor-health');

    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const today = now.toISOString().split('T')[0];

    const queryOpts = {
      startDate: yesterday.toISOString(),
      endDate: now.toISOString(),
      limit: 500,
    };

    const empty = { samples: [] as HealthSample[] };
    const [hrData, rhrData, hrvData, sleepData, stepsData, spo2Data, rrData] =
      await Promise.all([
        Health.readSamples({ ...queryOpts, dataType: 'heartRate' }).catch(() => empty),
        Health.readSamples({ ...queryOpts, dataType: 'restingHeartRate' }).catch(() => empty),
        Health.readSamples({ ...queryOpts, dataType: 'heartRateVariability' }).catch(() => empty),
        Health.readSamples({ ...queryOpts, dataType: 'sleep' }).catch(() => empty),
        Health.readSamples({ ...queryOpts, dataType: 'steps' }).catch(() => empty),
        Health.readSamples({ ...queryOpts, dataType: 'oxygenSaturation' }).catch(() => empty),
        Health.readSamples({ ...queryOpts, dataType: 'respiratoryRate' }).catch(() => empty),
      ]);

    // Process sleep
    const { durationHours, quality: sleepQuality } = calculateSleepQuality(sleepData.samples);

    // Process HRV
    const avgHrv = hrvData.samples.length > 0
      ? hrvData.samples.reduce((sum: number, s) => sum + s.value, 0) / hrvData.samples.length
      : undefined;

    // Process RHR
    const avgRhr = rhrData.samples.length > 0
      ? rhrData.samples.reduce((sum: number, s) => sum + s.value, 0) / rhrData.samples.length
      : undefined;

    // Process steps
    const totalSteps = stepsData.samples.reduce((sum: number, s) => sum + s.value, 0);

    // Process SpO2
    const avgSpo2 = spo2Data.samples.length > 0
      ? spo2Data.samples.reduce((sum: number, s) => sum + s.value, 0) / spo2Data.samples.length
      : undefined;

    // Process respiratory rate
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
      return { data: res.data, error: res.error ? { code: (res.error as any).code, message: res.error.message } : null };
    });

    if (result.error) {
      console.error('[healthkit] Sync failed:', result.error.message);
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
      return { data: res.data, error: res.error ? { code: (res.error as any).code, message: res.error.message } : null };
    });

    return true;
  } catch (e) {
    console.error('[healthkit] syncHealthKitData error:', e);
    return false;
  }
}
