// VYR Recompute — Unifies biometric data with subjective perceptions
import { supabase } from '@/integrations/supabase/client';
import { requireValidUserId, retryOnAuthErrorLabeled } from './auth-session';
import { computeState } from './vyr-engine';
import { calculateBaseline } from './vyr-baseline';
import type { BiometricData, BaselineValues } from './vyr-engine';

interface SubjectivePerceptions {
  energy: number;    // 0-10
  clarity: number;   // 0-10
  focus: number;     // 0-10
  stability: number; // 0-10
}

/**
 * Recompute VYR State merging existing biometric raw_input with subjective perceptions.
 * Fetches today's computed_state, enriches with perceptions, recalculates, and upserts.
 */
export async function recomputeStateWithPerceptions(perceptions: SubjectivePerceptions) {
  const userId = await requireValidUserId();
  const today = new Date().toISOString().split('T')[0];

  // 1. Fetch existing raw_input from computed_states
  const { data: existing } = await supabase
    .from('computed_states')
    .select('raw_input')
    .eq('user_id', userId)
    .eq('day', today)
    .maybeSingle();

  const rawBiometric = (existing?.raw_input as Record<string, any>) || {};

  // 2. Merge biometric data with subjective perceptions
  const enrichedData: BiometricData = {
    ...rawBiometric,
    subjectiveEnergy: perceptions.energy,
    subjectiveClarity: perceptions.clarity,
    subjectiveFocus: perceptions.focus,
    subjectiveStability: perceptions.stability,
  };

  // 3. Calculate baseline
  const baselineRaw = await calculateBaseline();
  const baseline: BaselineValues = {
    rhr: baselineRaw.rhr ?? undefined,
    hrv: baselineRaw.hrv ?? undefined,
    sleepDuration: baselineRaw.sleepDuration ?? undefined,
    sleepQuality: baselineRaw.sleepQuality ?? undefined,
    spo2: baselineRaw.spo2 ?? undefined,
  };

  // 4. Compute unified state
  const state = computeState(enrichedData, baseline);

  // 5. Upsert to computed_states with enriched raw_input
  await retryOnAuthErrorLabeled(async () => {
    const result = await supabase.from('computed_states').upsert({
      user_id: userId,
      day: today,
      score: state.score,
      level: state.level,
      pillars: state.pillars as any,
      phase: state.phase,
      raw_input: enrichedData as any,
    }, { onConflict: 'user_id,day' }).select();
    return result;
  }, { table: 'computed_states', operation: 'upsert' });

  return state;
}
