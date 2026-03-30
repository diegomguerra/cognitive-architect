/**
 * vyr-compute-client.ts — Cliente para a Edge Function vyr-compute-state
 *
 * Substitui o compute client-side quando online.
 * Fallback transparente para o engine local quando offline ou Edge Function indisponível.
 *
 * Fluxo:
 *   1. POST /functions/v1/vyr-compute-state com { day }
 *   2. Edge Function calcula score v4 server-side, persiste em computed_states,
 *      vyr_predictions e vyr_anomalies
 *   3. Retorna VYRComputeResult com estado completo + previsão d+1 + anomalia
 *   4. Em caso de falha: fallback para engine local (já existente)
 */

import { supabase } from '@/integrations/supabase/client';

export interface VYRPrediction {
  day: string;
  score: number;
  confidence: number;
  confidence_level: 'low' | 'medium' | 'high';
}

export interface VYRAnomaly {
  score: number;
  severity: 'low' | 'medium' | 'high';
  features_flagged: Record<string, number>;
}

export interface VYRComputeResult {
  day: string;
  score: number;
  level: string;
  phase: string;
  mode: 'bootstrap' | 'adaptive' | 'ml_ready';
  days_of_data: number;
  limiting_factor: string;
  pillars: {
    energia: number;
    clareza: number;
    estabilidade: number;
  };
  prediction: VYRPrediction | null;
  anomaly: VYRAnomaly | null;
  features: {
    hrv_ln: number | null;
    sleep_efficiency: number | null;
    rhr_trend_3d: number | null;
    recovery_quality: number | null;
    cognitive_readiness: number | null;
  };
  // Source: 'edge' = servidor, 'local' = fallback client-side
  _source: 'edge' | 'local';
}

/**
 * Chama a Edge Function vyr-compute-state para um dia específico.
 * Retorna o estado completo com previsão e anomalia.
 *
 * @param day - data no formato YYYY-MM-DD (default: hoje)
 * @returns VYRComputeResult | null em caso de erro sem fallback possível
 */
export async function computeStateViaEdge(day?: string): Promise<VYRComputeResult | null> {
  const targetDay = day ?? new Date().toISOString().split('T')[0];

  try {
    const { data, error } = await supabase.functions.invoke('vyr-compute-state', {
      body: { day: targetDay },
    });

    if (error) {
      console.warn('[vyr-compute-client] Edge Function error:', error.message);
      return null;
    }

    if (!data || typeof data.score !== 'number') {
      console.warn('[vyr-compute-client] Unexpected response format:', data);
      return null;
    }

    console.info('[vyr-compute-client] Edge result:', {
      day: targetDay,
      score: data.score,
      level: data.level,
      mode: data.mode,
      days_of_data: data.days_of_data,
    });

    return {
      ...data,
      _source: 'edge',
    } as VYRComputeResult;
  } catch (e) {
    console.warn('[vyr-compute-client] Network error:', e);
    return null;
  }
}

/**
 * Lê a última previsão d+1 armazenada em vyr_predictions para hoje + 1 dia.
 * Usado para exibir o card "Previsão de amanhã" na Home sem re-computar.
 */
export async function loadTomorrowPrediction(userId: string): Promise<VYRPrediction | null> {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('vyr_predictions')
    .select('predicted_for_day, predicted_score, confidence, confidence_level')
    .eq('user_id', userId)
    .eq('predicted_for_day', tomorrowStr)
    .maybeSingle();

  if (error || !data) return null;

  return {
    day: data.predicted_for_day,
    score: data.predicted_score,
    confidence: data.confidence,
    confidence_level: data.confidence_level as 'low' | 'medium' | 'high',
  };
}

/**
 * Lê a anomalia do dia atual (se existir e não reconhecida).
 * Usado para exibir alerta na Home.
 */
export async function loadTodayAnomaly(userId: string): Promise<VYRAnomaly | null> {
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('vyr_anomalies')
    .select('anomaly_score, severity, features_flagged')
    .eq('user_id', userId)
    .eq('day', today)
    .eq('acknowledged', false)
    .maybeSingle();

  if (error || !data) return null;

  return {
    score: data.anomaly_score,
    severity: data.severity as 'low' | 'medium' | 'high',
    features_flagged: (data.features_flagged ?? {}) as Record<string, number>,
  };
}

/**
 * Marca uma anomalia como reconhecida (usuário fechou o alerta).
 */
export async function acknowledgeAnomaly(userId: string, day: string): Promise<void> {
  await supabase
    .from('vyr_anomalies')
    .update({ acknowledged: true })
    .eq('user_id', userId)
    .eq('day', day);
}
