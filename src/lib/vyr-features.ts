/**
 * VYR Feature Engineering — Fase 2
 *
 * Calcula as 8 features derivadas com maior poder preditivo que os
 * biomarcadores brutos e salva em biomarker_features para uso no engine.
 *
 * Features:
 *  01. hrv_ln              — ln(hrv_rmssd) — distribuição log-normal, z-score mais estável
 *  02. sleep_efficiency    — sleep_duration / time_in_bed (proxy quando indisponível)
 *  03. rhr_trend_3d        — slope OLS dos últimos 3 dias de RHR
 *  04. circadian_regularity — 1 - (σ horários de dormir / 120)
 *  05. autonomic_balance   — índice composto SNA (hrv_ln_z - rhr_z + resp_z_inv) / 3
 *  06. load_recovery_ratio — carga vs capacidade de recuperação
 *  07. recovery_quality    — score composto de recuperação
 *  08. cognitive_readiness — prontidão cognitiva predita
 *
 * Data quality scores por pilar para penalização por dados ausentes.
 */

import { supabase } from '@/integrations/supabase/client';
import { requireValidUserId } from './auth-session';
import type { BiometricData } from './vyr-engine';
import type { BaselineMetrics } from './vyr-baseline';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface FeatureSet {
  // 8 features derivadas
  hrv_ln: number | null;
  sleep_efficiency: number | null;
  rhr_trend_3d: number | null;
  circadian_regularity: number | null;
  autonomic_balance: number | null;
  load_recovery_ratio: number | null;
  recovery_quality: number | null;
  cognitive_readiness: number | null;
  // Data quality scores (0-1) por pilar
  quality_energia: number;
  quality_clareza: number;
  quality_estabilidade: number;
}

interface HistoricalDay {
  day: string;
  rhr: number | null;
  hrv_rmssd: number | null;
  hrv_sdnn: number | null;
  sleep_duration_hours: number | null;
  sleep_quality: number | null;
  respiratory_rate: number | null;
  active_energy_kcal: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Regressão linear OLS simples — retorna o slope (inclinação).
 * Usada para rhr_trend_3d: slope positivo = RHR subindo = sobrecarga.
 */
function olsSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const xs = values.map((_, i) => i);
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (values[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/**
 * Z-score seguro — retorna 0 se std for inválido.
 */
function safeZ(value: number, mean: number, std: number): number {
  if (!std || std < 0.001) return 0;
  return clamp((value - mean) / std, -3, 3);
}

/**
 * EWMA (Exponential Weighted Moving Average) dos últimos N valores.
 * Usado para soft imputation quando dado ausente + histórico disponível.
 * λ=0.94 como definido na arquitetura v4.
 */
function ewma(values: number[], lambda = 0.94): number {
  if (values.length === 0) return 0;
  let result = values[0];
  for (let i = 1; i < values.length; i++) {
    result = lambda * result + (1 - lambda) * values[i];
  }
  return result;
}

// ─── Data quality scores ──────────────────────────────────────────────────────

/**
 * Calcula o data_quality_score do pilar Energia (0-1).
 * Pesos proporcionais à importância de cada feature no pilar.
 */
function computeQualidadeEnergia(data: BiometricData): number {
  const weights = { rhr: 1.4, sleepEfficiency: 1.0, activeEnergy: 0.5, spo2: 0.4, basalEnergy: 0.3, subjectiveEnergy: 0.6 };
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let covered = 0;
  if (data.rhr != null) covered += weights.rhr;
  if (data.sleepDuration != null) covered += weights.sleepEfficiency; // proxy
  if (data.activeEnergyKcal != null) covered += weights.activeEnergy;
  if (data.spo2 != null) covered += weights.spo2;
  if (data.basalEnergyKcal != null) covered += weights.basalEnergy;
  if (data.subjectiveEnergy != null) covered += weights.subjectiveEnergy;
  return Math.round((covered / total) * 100) / 100;
}

function computeQualidadeClareza(data: BiometricData): number {
  const weights = { sleepEfficiency: 1.1, circadian: 0.9, hrv: 0.5, awakenings: 0.5, subjectiveClarity: 0.5, subjectiveFocus: 0.5 };
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let covered = 0;
  if (data.sleepDuration != null) covered += weights.sleepEfficiency;
  if (data.sleepQuality != null) covered += weights.circadian; // proxy circadian
  if (data.hrvRawMs != null || data.hrvIndex != null) covered += weights.hrv;
  if (data.awakenings != null) covered += weights.awakenings;
  if (data.subjectiveClarity != null) covered += weights.subjectiveClarity;
  if (data.subjectiveFocus != null) covered += weights.subjectiveFocus;
  return Math.round((covered / total) * 100) / 100;
}

function computeQualidadeEstabilidade(data: BiometricData): number {
  const weights = { hrv_ln: 2.5, autonomicBalance: 1.0, rhrTrend: 0.7, skinTemp: 0.4, hrRecovery: 0.4, respiratoryRate: 0.4 };
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let covered = 0;
  if (data.hrvRawMs != null) covered += weights.hrv_ln;
  if (data.rhr != null && data.respiratoryRate != null) covered += weights.autonomicBalance;
  if (data.rhr != null) covered += weights.rhrTrend;
  if (data.skinTempDelta != null) covered += weights.skinTemp;
  if (data.hrRecovery1Min != null) covered += weights.hrRecovery;
  if (data.respiratoryRate != null) covered += weights.respiratoryRate;
  return Math.round((covered / total) * 100) / 100;
}

// ─── Feature computation ──────────────────────────────────────────────────────

/**
 * Calcula as 8 features derivadas a partir dos dados biométricos do dia
 * e do histórico dos últimos 7 dias.
 */
export function computeFeatures(
  data: BiometricData,
  history: HistoricalDay[],
  baseline: BaselineMetrics,
): FeatureSet {
  // Ordenar histórico do mais antigo ao mais recente
  const sorted = [...history].sort((a, b) => a.day.localeCompare(b.day));

  // ── Feature 01: hrv_ln ────────────────────────────────────────────────────
  // ln(hrv_rmssd) — HRV segue distribuição log-normal, z-score mais estável no domínio ln
  let hrv_ln: number | null = null;
  const rawHrv = data.hrvRawMs;
  if (rawHrv != null && rawHrv >= 5 && rawHrv <= 300) {
    hrv_ln = Math.round(Math.log(rawHrv) * 1000) / 1000;
  } else {
    // Soft imputation: EWMA dos últimos 7 dias com peso 50%
    const historicHrvVals = sorted
      .map(d => d.hrv_rmssd ?? d.hrv_sdnn)
      .filter((v): v is number => v != null && v >= 5 && v <= 300);
    if (historicHrvVals.length >= 3) {
      const imputed = ewma(historicHrvVals) * 0.5; // peso reduzido — dado ausente hoje
      hrv_ln = Math.round(Math.log(Math.max(5, imputed)) * 1000) / 1000;
    }
  }

  // ── Feature 02: sleep_efficiency ─────────────────────────────────────────
  // sleep_duration / time_in_bed — proxy: sleep_quality/100 × duration × 1.25
  let sleep_efficiency: number | null = null;
  if (data.sleepDuration != null && data.sleepDuration > 0) {
    if (data.sleepQuality != null && data.sleepQuality > 0) {
      // Proxy: estima time_in_bed via qualidade
      const estimatedTimeInBed = data.sleepDuration * (100 / Math.max(1, data.sleepQuality)) * 0.8;
      sleep_efficiency = clamp(
        Math.round((data.sleepDuration / Math.max(0.1, estimatedTimeInBed)) * 1000) / 1000,
        0, 1
      );
    } else {
      // Sem qualidade: assume 85% de eficiência como valor neutro
      sleep_efficiency = 0.85;
    }
  }

  // ── Feature 03: rhr_trend_3d ──────────────────────────────────────────────
  // Slope OLS dos últimos 3 dias de RHR — negativo = recuperação, positivo = sobrecarga
  let rhr_trend_3d: number | null = null;
  const rhrHistory = sorted
    .slice(-3) // últimos 3 dias históricos
    .map(d => d.rhr)
    .filter((v): v is number => v != null);
  // Adiciona o valor de hoje se disponível
  const rhrSeries = data.rhr != null ? [...rhrHistory, data.rhr] : rhrHistory;
  if (rhrSeries.length >= 2) {
    rhr_trend_3d = Math.round(olsSlope(rhrSeries) * 1000) / 1000;
  }

  // ── Feature 04: circadian_regularity ─────────────────────────────────────
  // 1 - (σ horários de dormir / 120) — Lunsford-Avery et al. 2018
  // Proxy via desvio padrão da qualidade de sono dos últimos 7 dias
  // (horários de dormir não estão na DB ainda — sleep_quality como proxy)
  let circadian_regularity: number | null = null;
  const sleepQualHistory = sorted
    .map(d => d.sleep_quality)
    .filter((v): v is number => v != null);
  if (sleepQualHistory.length >= 3) {
    const mean = sleepQualHistory.reduce((a, b) => a + b, 0) / sleepQualHistory.length;
    const std = Math.sqrt(sleepQualHistory.reduce((s, v) => s + (v - mean) ** 2, 0) / sleepQualHistory.length);
    // Normalizado: std 0 → regularity 1.0, std 30+ → regularity 0
    circadian_regularity = clamp(Math.round((1 - std / 30) * 1000) / 1000, 0, 1);
  } else if (data.sleepQuality != null) {
    circadian_regularity = 0.5; // valor neutro sem histórico suficiente
  }

  // ── Feature 05: autonomic_balance ────────────────────────────────────────
  // (hrv_ln_z - rhr_z + resp_z_inv) / 3 — índice composto SNA
  let autonomic_balance: number | null = null;
  const blHrv = baseline.hrv;
  const blRhr = baseline.rhr;
  let componentCount = 0;
  let abSum = 0;

  if (hrv_ln != null && blHrv != null) {
    abSum += safeZ(hrv_ln, blHrv.mean, blHrv.std);
    componentCount++;
  }
  if (data.rhr != null && blRhr != null) {
    abSum += -safeZ(data.rhr, blRhr.mean, blRhr.std); // invertido: RHR alto = SNA ruim
    componentCount++;
  }
  if (data.respiratoryRate != null) {
    // RR população: mean ~15, std ~3 — invertido: RR alto = SNA ruim
    abSum += -safeZ(data.respiratoryRate, 15, 3);
    componentCount++;
  }
  if (componentCount >= 2) {
    autonomic_balance = Math.round((abSum / componentCount) * 1000) / 1000;
  }

  // ── Feature 06: load_recovery_ratio ──────────────────────────────────────
  // (active_kcal × rhr_z) / max(hrv_ln × sleep_eff, 0.01)
  // >1.5 = sistema em débito, <0.7 = subcarregado
  let load_recovery_ratio: number | null = null;
  if (data.activeEnergyKcal != null && data.rhr != null && hrv_ln != null && sleep_efficiency != null) {
    const rhrZ = blRhr != null ? clamp(safeZ(data.rhr, blRhr.mean, blRhr.std), 0.1, 3) : 1.0;
    const carga = (data.activeEnergyKcal / 300) * rhrZ; // normaliza kcal (~300 = baseline moderado)
    const recuperacao = Math.max(0.01, hrv_ln * sleep_efficiency);
    load_recovery_ratio = Math.round(clamp(carga / recuperacao, 0, 5) * 100) / 100;
  }

  // ── Feature 07: recovery_quality ─────────────────────────────────────────
  // hrv_z×0.4 + sleep_eff_z×0.35 + rhr_trend_z×0.25
  // Pesos derivados das correlações reais (iOS: HRV -0.994, Android: -0.733)
  let recovery_quality: number | null = null;
  const blHrvIndex = baseline.hrv;
  const blSleepDur = baseline.sleepDuration;

  let rqSum = 0;
  let rqCount = 0;

  if (hrv_ln != null && blHrv != null) {
    rqSum += safeZ(hrv_ln, blHrv.mean, blHrv.std) * 0.4;
    rqCount++;
  }
  if (sleep_efficiency != null && blSleepDur != null) {
    // Normaliza sleep_efficiency vs baseline de duração de sono
    const sleepEffBaseline = blSleepDur.mean > 0 ? blSleepDur.mean / 9 : 0.85; // 9h = eficiência 1.0
    rqSum += safeZ(sleep_efficiency, sleepEffBaseline, 0.12) * 0.35;
    rqCount++;
  }
  if (rhr_trend_3d != null) {
    // Trend: negativo é bom, normaliza com std ~1
    rqSum += safeZ(-rhr_trend_3d, 0, 1) * 0.25; // inverte: queda RHR = recuperação
    rqCount++;
  }

  if (rqCount >= 2) {
    // Mapeia z-score [-3,3] para [0,1] (0.5 = neutro)
    const rqRaw = rqSum / (rqCount > 0 ? 1 : rqCount);
    recovery_quality = Math.round(clamp((rqRaw + 3) / 6, 0, 1) * 1000) / 1000;
  }

  // ── Feature 08: cognitive_readiness ──────────────────────────────────────
  // recovery×0.5 + sleep_eff_z×0.3 + circ_z×0.2
  let cognitive_readiness: number | null = null;
  let crSum = 0;
  let crCount = 0;

  if (recovery_quality != null) {
    crSum += recovery_quality * 0.5;
    crCount++;
  }
  if (sleep_efficiency != null) {
    crSum += sleep_efficiency * 0.3; // já está em [0,1]
    crCount++;
  }
  if (circadian_regularity != null) {
    crSum += circadian_regularity * 0.2;
    crCount++;
  }

  if (crCount >= 2) {
    cognitive_readiness = Math.round(clamp(crSum, 0, 1) * 1000) / 1000;
  }

  return {
    hrv_ln,
    sleep_efficiency,
    rhr_trend_3d,
    circadian_regularity,
    autonomic_balance,
    load_recovery_ratio,
    recovery_quality,
    cognitive_readiness,
    quality_energia: computeQualidadeEnergia(data),
    quality_clareza: computeQualidadeClareza(data),
    quality_estabilidade: computeQualidadeEstabilidade(data),
  };
}

// ─── Persist ──────────────────────────────────────────────────────────────────

/**
 * Busca os últimos 7 dias de ring_daily_data para um usuário.
 * Usado para calcular trends e regularidade circadiana.
 */
async function fetchRecentHistory(userId: string, days = 7): Promise<HistoricalDay[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const { data, error } = await supabase
    .from('ring_daily_data')
    .select('day, metrics')
    .eq('user_id', userId)
    .gte('day', cutoff.toISOString().split('T')[0])
    .order('day', { ascending: true });

  if (error || !data) return [];

  return data.map(row => {
    const m = (row.metrics ?? {}) as Record<string, unknown>;
    return {
      day: row.day as string,
      rhr: (m.rhr as number) ?? null,
      hrv_rmssd: (m.hrv_rmssd as number) ?? null,
      hrv_sdnn: (m.hrv_sdnn as number) ?? null,
      sleep_duration_hours: (m.sleep_duration_hours as number) ?? null,
      sleep_quality: (m.sleep_quality as number) ?? null,
      respiratory_rate: (m.respiratory_rate as number) ?? null,
      active_energy_kcal: (m.active_energy_kcal as number) ?? null,
    };
  });
}

/**
 * Calcula e persiste o FeatureSet de um dia em biomarker_features.
 * Chamado após cada sync bem-sucedido, antes do engine computar o score.
 *
 * @param day       — data no formato YYYY-MM-DD
 * @param data      — BiometricData já populado pelo sync
 * @param baseline  — baseline do usuário (30d)
 * @param userId    — opcional; se omitido usa requireValidUserId()
 */
export async function computeAndStoreFeatures(
  day: string,
  data: BiometricData,
  baseline: BaselineMetrics,
  userId?: string,
): Promise<FeatureSet | null> {
  try {
    const uid = userId ?? await requireValidUserId();
    const history = await fetchRecentHistory(uid);
    const features = computeFeatures(data, history, baseline);

    const { error } = await (supabase as any)
      .from('biomarker_features')
      .upsert({
        user_id: uid,
        day,
        hrv_ln: features.hrv_ln,
        sleep_efficiency: features.sleep_efficiency,
        rhr_trend_3d: features.rhr_trend_3d,
        circadian_regularity: features.circadian_regularity,
        autonomic_balance: features.autonomic_balance,
        load_recovery_ratio: features.load_recovery_ratio,
        recovery_quality: features.recovery_quality,
        cognitive_readiness: features.cognitive_readiness,
        quality_energia: features.quality_energia,
        quality_clareza: features.quality_clareza,
        quality_estabilidade: features.quality_estabilidade,
        engine_version: 'v4',
      }, { onConflict: 'user_id,day' });

    if (error) {
      console.error('[vyr-features] upsert failed:', error.message);
      return null;
    }

    console.info('[vyr-features] features stored for', day, {
      hrv_ln: features.hrv_ln,
      sleep_efficiency: features.sleep_efficiency,
      rhr_trend_3d: features.rhr_trend_3d,
      circadian_regularity: features.circadian_regularity,
      recovery_quality: features.recovery_quality,
      cognitive_readiness: features.cognitive_readiness,
      quality_estabilidade: features.quality_estabilidade,
    });

    return features;
  } catch (e) {
    console.error('[vyr-features] computeAndStoreFeatures failed:', e);
    return null;
  }
}
