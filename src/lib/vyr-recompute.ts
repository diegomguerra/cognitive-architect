// VYR Recompute — Reads ring_daily_data, computes state, writes computed_states
import { supabase } from '@/integrations/supabase/client';
import { requireValidUserId, retryOnAuthErrorLabeled } from './auth-session';
import { computeState } from './vyr-engine';
import { calculateBaseline } from './vyr-baseline';
import type { BiometricData, VYRState, BaselineValues } from './vyr-engine';

interface SubjectivePerceptions {
  energy: number;    // 0-10
  clarity: number;   // 0-10
  focus: number;     // 0-10
  stability: number; // 0-10
}

interface RingMetrics {
  hr_avg?: number | null;
  rhr?: number | null;
  hrv_sdnn?: number | null;
  hrv_index?: number | null;
  stress_level?: number | null;
  sleep_duration_hours?: number | null;
  sleep_quality?: number | null;
  steps?: number | null;
  spo2?: number | null;
}

/**
 * Convert ring_daily_data metrics to BiometricData format used by vyr-engine
 */
function metricsToBiometric(m: RingMetrics): BiometricData {
  return {
    rhr: m.rhr ?? undefined,
    hrvRawMs: m.hrv_sdnn ?? undefined,
    hrvIndex: m.hrv_index ?? undefined,
    stressLevel: m.stress_level ?? undefined,
    sleepDuration: m.sleep_duration_hours ?? undefined,
    sleepQuality: m.sleep_quality ?? undefined,
    spo2: m.spo2 ?? undefined,
  };
}

async function getBaseline(knownUserId?: string): Promise<BaselineValues> {
  const raw = await calculateBaseline(knownUserId);
  return {
    rhr: raw.rhr ?? undefined,
    hrv: raw.hrv ?? undefined,
    sleepDuration: raw.sleepDuration ?? undefined,
    sleepQuality: raw.sleepQuality ?? undefined,
    spo2: raw.spo2 ?? undefined,
  };
}

/**
 * Persist computed_states with a UNIFIED raw_input shape: the full snake_case
 * ring_daily_data.metrics object (preserving every biomarker) plus subjective
 * perceptions. This matches the edge function `vyr-compute-state` so admin
 * queries and analytics don't have to juggle camelCase vs snake_case.
 */
async function upsertComputedState(
  userId: string,
  day: string,
  state: VYRState,
  metrics: RingMetrics | Record<string, unknown>,
  subjective?: {
    subjectiveEnergy?: number;
    subjectiveClarity?: number;
    subjectiveFocus?: number;
    subjectiveStability?: number;
  },
) {
  const raw_input = {
    ...(metrics as Record<string, unknown>),
    ...(subjective?.subjectiveEnergy != null && { subjectiveEnergy: subjective.subjectiveEnergy }),
    ...(subjective?.subjectiveClarity != null && { subjectiveClarity: subjective.subjectiveClarity }),
    ...(subjective?.subjectiveFocus != null && { subjectiveFocus: subjective.subjectiveFocus }),
    ...(subjective?.subjectiveStability != null && { subjectiveStability: subjective.subjectiveStability }),
    engine_version: 'client-v5',
  };

  await retryOnAuthErrorLabeled(async () => {
    const result = await supabase.from('computed_states').upsert({
      user_id: userId,
      day,
      score: state.score,
      level: state.level,
      pillars: state.pillars as any,
      phase: state.phase,
      raw_input: raw_input as any,
    }, { onConflict: 'user_id,day' }).select();
    return result;
  }, { table: 'computed_states', operation: 'upsert' });
}

/**
 * Core pipeline: reads ring_daily_data for a given day, computes VYR State,
 * and writes to computed_states. This is the missing link between wearable
 * data ingestion and the frontend store.
 *
 * Merges with existing subjective perceptions from daily_reviews if available.
 */
export async function computeAndStoreState(day?: string, knownUserId?: string): Promise<VYRState | null> {
  const userId = knownUserId ?? await requireValidUserId();
  const targetDay = day ?? new Date().toISOString().split('T')[0];

  // 1. Read biometric data from ring_daily_data
  const { data: ringRow } = await supabase
    .from('ring_daily_data')
    .select('metrics')
    .eq('user_id', userId)
    .eq('day', targetDay)
    .maybeSingle();

  if (!ringRow?.metrics) {
    console.info('[vyr-recompute] No ring_daily_data for', targetDay);
    return null;
  }

  const metrics = ringRow.metrics as unknown as RingMetrics;
  const biometric = metricsToBiometric(metrics);

  // 2. Merge with subjective perceptions if available
  const { data: review } = await supabase
    .from('daily_reviews')
    .select('energy_score, clarity_score, focus_score, mood_score')
    .eq('user_id', userId)
    .eq('day', targetDay)
    .maybeSingle();

  const enriched: BiometricData = {
    ...biometric,
    ...(review?.energy_score != null && { subjectiveEnergy: review.energy_score }),
    ...(review?.clarity_score != null && { subjectiveClarity: review.clarity_score }),
    ...(review?.focus_score != null && { subjectiveFocus: review.focus_score }),
    ...(review?.mood_score != null && { subjectiveStability: review.mood_score }),
  };

  // 3. Calculate baseline + compute state
  const baseline = await getBaseline(userId);
  const state = computeState(enriched, baseline);

  // 4. Persist — raw_input uses the ORIGINAL snake_case metrics so admin/analytics
  // queries have a single consistent shape across all compute paths.
  await upsertComputedState(userId, targetDay, state, metrics, {
    subjectiveEnergy: review?.energy_score ?? undefined,
    subjectiveClarity: review?.clarity_score ?? undefined,
    subjectiveFocus: review?.focus_score ?? undefined,
    subjectiveStability: review?.mood_score ?? undefined,
  });

  console.info('[vyr-recompute] State computed for', targetDay, '→ score:', state.score, state.level);
  return state;
}

export interface PhaseValues {
  foco: number;
  clareza: number;
  energia: number;
  estabilidade: number;
}

/**
 * When all 3 phases (BOOT, HOLD, CLEAR) are recorded, compute the arithmetic
 * mean of the 4 perception params, upsert to daily_reviews, then recompute state.
 */
export async function computeDayMeanFromPhases(allValues: Record<string, PhaseValues>, knownUserId?: string) {
  const userId = knownUserId ?? await requireValidUserId();
  const today = new Date().toISOString().split('T')[0];

  const phaseKeys = Object.keys(allValues);
  if (phaseKeys.length === 0) return;

  const mean = (key: keyof PhaseValues) => {
    const vals = phaseKeys.map((p) => allValues[p][key]);
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  };

  const focusMean = mean('foco');
  const clarityMean = mean('clareza');
  const energyMean = mean('energia');
  const stabilityMean = mean('estabilidade');

  // Upsert daily_reviews with averaged scores
  await retryOnAuthErrorLabeled(async () => {
    const result = await supabase.from('daily_reviews').upsert({
      user_id: userId,
      day: today,
      focus_score: focusMean,
      clarity_score: clarityMean,
      energy_score: energyMean,
      mood_score: stabilityMean,
    }, { onConflict: 'user_id,day' }).select();
    return result;
  }, { table: 'daily_reviews', operation: 'upsert' });

  // Recompute state with the averaged perceptions
  await recomputeStateWithPerceptions({
    energy: energyMean,
    clarity: clarityMean,
    focus: focusMean,
    stability: stabilityMean,
  });
}

/**
 * Recompute VYR State merging existing biometric raw_input with subjective perceptions.
 * Called when the user submits perceptions in PerceptionsTab.
 */
export async function recomputeStateWithPerceptions(perceptions: SubjectivePerceptions, knownUserId?: string) {
  const userId = knownUserId ?? await requireValidUserId();
  const today = new Date().toISOString().split('T')[0];

  // 1. Try to get biometric data from ring_daily_data first, fallback to existing raw_input
  let biometric: BiometricData = {};

  const { data: ringRow } = await supabase
    .from('ring_daily_data')
    .select('metrics')
    .eq('user_id', userId)
    .eq('day', today)
    .maybeSingle();

  let metricsForRaw: Record<string, unknown> = {};
  if (ringRow?.metrics) {
    metricsForRaw = ringRow.metrics as Record<string, unknown>;
    biometric = metricsToBiometric(ringRow.metrics as unknown as RingMetrics);
  } else {
    // Fallback: use existing raw_input from computed_states. Accept either
    // snake_case (edge function / new client) or legacy camelCase shapes.
    const { data: existing } = await supabase
      .from('computed_states')
      .select('raw_input')
      .eq('user_id', userId)
      .eq('day', today)
      .maybeSingle();
    const prev = (existing?.raw_input as Record<string, any>) || {};
    metricsForRaw = prev;
    biometric = {
      rhr: prev.rhr ?? undefined,
      hrvRawMs: prev.hrv_sdnn ?? prev.hrvRawMs ?? undefined,
      hrvIndex:  prev.hrv_index ?? prev.hrvIndex ?? undefined,
      stressLevel: prev.stress_level ?? prev.stressLevel ?? undefined,
      sleepDuration: prev.sleep_duration_hours ?? prev.sleepDuration ?? undefined,
      sleepQuality: prev.sleep_quality ?? prev.sleepQuality ?? undefined,
      spo2: prev.spo2 ?? undefined,
    };
  }

  // 2. Merge biometric data with subjective perceptions
  const enriched: BiometricData = {
    ...biometric,
    subjectiveEnergy: perceptions.energy,
    subjectiveClarity: perceptions.clarity,
    subjectiveFocus: perceptions.focus,
    subjectiveStability: perceptions.stability,
  };

  // 3. Calculate baseline + compute state
  const baseline = await getBaseline(userId);
  const state = computeState(enriched, baseline);

  // 4. Persist — raw_input = original metrics (snake_case) + subjective
  await upsertComputedState(userId, today, state, metricsForRaw, {
    subjectiveEnergy: perceptions.energy,
    subjectiveClarity: perceptions.clarity,
    subjectiveFocus: perceptions.focus,
    subjectiveStability: perceptions.stability,
  });

  return state;
}
