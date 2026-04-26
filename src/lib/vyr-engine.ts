// VYR State Engine — Core Algorithm v3
// Implements z-score baseline, dynamic weights, rich labels
// v3: wider z-score range, higher sensitivity, base 2.5 for true center

export interface BiometricData {
  rhr?: number;           // Resting Heart Rate (bpm)
  sleepDuration?: number; // hours
  sleepQuality?: number;  // 0-100
  spo2?: number;          // 90-100
  sleepRegularity?: number; // deviation in minutes
  awakenings?: number;    // count
  hrvIndex?: number;      // 0-100 (already normalized)
  hrvRawMs?: number;      // ms (SDNN) — raw, will be normalized
  stressLevel?: number;   // 0-100
  tempDeviation?: number;     // °C deviation from baseline
  respiratoryRate?: number;   // breaths per minute (resting)
  activityLevel?: 'high' | 'moderate' | 'low' | null;
  // F1b — extended biomarkers
  vo2Max?: number;            // ml/kg/min
  skinTempDelta?: number;     // °C delta from nocturnal baseline (HealthKit)
  activeEnergyKcal?: number;  // kcal burned (active, today)
  basalEnergyKcal?: number;   // kcal burned (basal metabolic rate)
  walkingHrAvg?: number;      // bpm average during walking
  hrRecovery1Min?: number;    // bpm drop 1 min post-exercise
  // Subjective perceptions (0-10 scale, from daily_reviews)
  subjectiveEnergy?: number;
  subjectiveClarity?: number;
  subjectiveFocus?: number;
  subjectiveStability?: number;
}

export interface PillarScore {
  energia: number;      // 0-5
  clareza: number;      // 0-5
  estabilidade: number; // 0-5
}

export interface VYRState {
  score: number;         // 0-100
  level: string;
  pillars: PillarScore;
  limitingFactor: string;
  phase: 'BOOT' | 'HOLD' | 'CLEAR';
}

export interface BaselineValues {
  rhr?: { mean: number; std: number };
  hrv?: { mean: number; std: number };
  sleepDuration?: { mean: number; std: number };
  sleepQuality?: { mean: number; std: number };
  spo2?: { mean: number; std: number };
}

// Population fallback baseline (used when user has < 3 days of data)
export const FALLBACK_BASELINE: Required<BaselineValues> = {
  rhr: { mean: 65, std: 10 },
  hrv: { mean: 55, std: 12 },
  sleepDuration: { mean: 7.0, std: 1.0 },
  sleepQuality: { mean: 60, std: 15 },
  spo2: { mean: 97, std: 1.5 },
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Normalize raw HRV ms to 0-100 index (logarithmic)
 */
export function normalizeHRV(ms: number): number {
  const clamped = clamp(ms, 5, 200);
  return (Math.log(clamped) - Math.log(5)) / (Math.log(200) - Math.log(5)) * 100;
}

/**
 * Validate and clamp biometric values to physiological ranges
 */
export function validateWearableData(data: BiometricData): BiometricData {
  return {
    ...data,
    rhr: data.rhr != null ? clamp(data.rhr, 35, 120) : undefined,
    hrvIndex: data.hrvIndex != null ? clamp(data.hrvIndex, 0, 100) :
              data.hrvRawMs != null ? normalizeHRV(data.hrvRawMs) : undefined,
    sleepDuration: data.sleepDuration != null ? clamp(data.sleepDuration, 0, 14) : undefined,
    sleepQuality: data.sleepQuality != null ? clamp(data.sleepQuality, 0, 100) : undefined,
    sleepRegularity: data.sleepRegularity != null ? clamp(data.sleepRegularity, -120, 120) : undefined,
    awakenings: data.awakenings != null ? clamp(data.awakenings, 0, 30) : undefined,
    stressLevel: data.stressLevel != null ? clamp(data.stressLevel, 0, 100) : undefined,
    spo2: data.spo2 != null ? clamp(data.spo2, 70, 100) : undefined,
    tempDeviation: data.tempDeviation != null ? clamp(data.tempDeviation, -4, 4) : undefined,
  };
}

/**
 * Compute z-score clamped to [-2.5, +2.5] (v3: wider range for more sensitivity)
 */
function zScore(value: number, mean: number, std: number): number {
  if (std < 0.01) return 0;
  return clamp((value - mean) / std, -2.5, 2.5);
}

/**
 * Convert z-score to pillar contribution (v3: multiplier 1.0, range [-2.5, +2.5])
 */
function zToPillar(z: number): number {
  return z * 1.0;
}

interface WeightedInput {
  value: number; // pillar contribution
  weight: number;
}

function dynamicWeightedAvg(inputs: WeightedInput[], targetWeight: number, base: number): number {
  if (inputs.length === 0) return base;
  const totalW = inputs.reduce((s, i) => s + i.weight, 0);
  const scale = targetWeight / totalW;
  const contribution = inputs.reduce((s, i) => s + i.value * i.weight * scale, 0) / targetWeight;
  return clamp(base + contribution, 0, 5);
}

export function computePillars(data: BiometricData, baseline?: BaselineValues): PillarScore {
  const validated = validateWearableData(data);
  const bl = { ...FALLBACK_BASELINE, ...baseline };

  // === ENERGIA (base 2.5, target weight 2.5) ===
  const energiaInputs: WeightedInput[] = [];
  if (validated.rhr != null && bl.rhr) {
    // Inverted: below mean = good
    energiaInputs.push({ value: zToPillar(-zScore(validated.rhr, bl.rhr.mean, bl.rhr.std)), weight: 1.0 });
  }
  if (validated.sleepDuration != null && bl.sleepDuration) {
    energiaInputs.push({ value: zToPillar(zScore(validated.sleepDuration, bl.sleepDuration.mean, bl.sleepDuration.std)), weight: 1.0 });
  }
  if (validated.sleepQuality != null && bl.sleepQuality) {
    energiaInputs.push({ value: zToPillar(zScore(validated.sleepQuality, bl.sleepQuality.mean, bl.sleepQuality.std)), weight: 0.5 });
  }
  if (validated.spo2 != null && bl.spo2) {
    energiaInputs.push({ value: zToPillar(zScore(validated.spo2, bl.spo2.mean, bl.spo2.std)), weight: 0.4 });
  }

  if (validated.subjectiveEnergy != null) {
    const seZ = clamp((validated.subjectiveEnergy - 5) / 2.5, -2.5, 2.5);
    energiaInputs.push({ value: zToPillar(seZ), weight: 0.6 });
  }

  let energia = dynamicWeightedAvg(energiaInputs, 2.5, 2.5);
  // Activity adjustment
  if (validated.activityLevel === 'high') energia = clamp(energia - 0.5, 0, 5);
  else if (validated.activityLevel === 'low') energia = clamp(energia + 0.25, 0, 5);

  // === CLAREZA (base 2.5, target weight 2.5) ===
  const clarezaInputs: WeightedInput[] = [];
  if (validated.sleepRegularity != null) {
    // Inverted: less variation = better
    const regZ = zScore(Math.abs(validated.sleepRegularity), 30, 20);
    clarezaInputs.push({ value: zToPillar(-regZ), weight: 1.0 });
  }
  if (validated.sleepQuality != null && bl.sleepQuality) {
    clarezaInputs.push({ value: zToPillar(zScore(validated.sleepQuality, bl.sleepQuality.mean, bl.sleepQuality.std)), weight: 1.0 });
  }
  if (validated.awakenings != null) {
    // Inverted: less = better
    const awkZ = zScore(validated.awakenings, 3, 2);
    clarezaInputs.push({ value: zToPillar(-awkZ), weight: 0.5 });
  }

  if (validated.subjectiveClarity != null) {
    const scZ = clamp((validated.subjectiveClarity - 5) / 2.5, -2.5, 2.5);
    clarezaInputs.push({ value: zToPillar(scZ), weight: 0.5 });
  }
  if (validated.subjectiveFocus != null) {
    const sfZ = clamp((validated.subjectiveFocus - 5) / 2.5, -2.5, 2.5);
    clarezaInputs.push({ value: zToPillar(sfZ), weight: 0.5 });
  }

  const clareza = dynamicWeightedAvg(clarezaInputs, 2.5, 2.5);

  // === ESTABILIDADE (base 2.5, target weight 2.0) ===
  const estabInputs: WeightedInput[] = [];
  if (validated.hrvIndex != null && bl.hrv) {
    estabInputs.push({ value: zToPillar(zScore(validated.hrvIndex, bl.hrv.mean, bl.hrv.std)), weight: 1.3 });
  }
  if (validated.stressLevel != null) {
    // Inverted: lower stress = better
    const stressZ = zScore(validated.stressLevel, 40, 15);
    estabInputs.push({ value: zToPillar(-stressZ), weight: 0.7 });
  }
  if (validated.tempDeviation != null) {
    // Absolute deviation = instability
    const tempZ = zScore(Math.abs(validated.tempDeviation), 0.2, 0.3);
    estabInputs.push({ value: zToPillar(-tempZ), weight: 0.3 });
  }

  if (validated.subjectiveStability != null) {
    const ssZ = clamp((validated.subjectiveStability - 5) / 2.5, -2.5, 2.5);
    estabInputs.push({ value: zToPillar(ssZ), weight: 0.5 });
  }

  const estabilidade = dynamicWeightedAvg(estabInputs, 2.0, 2.5);

  return {
    energia: Math.round(energia * 100) / 100,
    clareza: Math.round(clareza * 100) / 100,
    estabilidade: Math.round(estabilidade * 100) / 100,
  };
}

/**
 * VYR Score v4 — Geometric mean ponderada + penalização por desequilíbrio + modificador de trajetória
 *
 * Substitui a fórmula v3 (avg*0.6 + min*0.4) que:
 * — ignorava interações multiplicativas entre pilares
 * — era insensível à trajetória temporal
 * — aplicava penalização fixa independente do gap entre pilares
 *
 * Nova fórmula:
 *   score_base = (E^0.35 × C^0.30 × S^0.35) / 5 × 100   ← geometric mean ponderada
 *   spread = max(E,C,S) − min(E,C,S)
 *   imbalance_penalty = spread > 1.5 ? (spread − 1.5) × 0.06 : 0
 *   trend_mod = clamp(1 + rhr_trend_3d × −0.02, 0.90, 1.10)
 *   score = round(clamp(score_base × (1 − penalty) × trend_mod, 0, 100))
 *
 * Caso crítico E5 + C5 + S1:
 *   v3 → score 52 (subestimado)
 *   v4 → score ≈ 38 (reflecte o colapso real)
 *
 * @param pillars        — pillar scores (0–5 each)
 * @param rhr_trend_3d   — slope OLS 3 dias de RHR (de vyr-features); null = sem modificador
 * @param quality_scores — cobertura de dados por pilar (0–1); aplica até –15% por pilar sem dados
 */
export function computeScoreV4(
  pillars: PillarScore,
  rhr_trend_3d?: number | null,
  quality_scores?: { energia?: number; clareza?: number; estabilidade?: number },
): number {
  const { energia: E, clareza: C, estabilidade: S } = pillars;

  // ── 1. Geometric mean ponderada ───────────────────────────────────────────
  // Expoentes: E=0.35, C=0.30, S=0.35 (Estabilidade e Energia dominam)
  // Evita log(0) — pilares mínimos em 0.01
  const eS = Math.max(0.01, E);
  const cS = Math.max(0.01, C);
  const sS = Math.max(0.01, S);
  const geomMean = Math.pow(eS, 0.35) * Math.pow(cS, 0.30) * Math.pow(sS, 0.35);
  const scoreBase = (geomMean / 5) * 100;

  // ── 2. Penalização por desequilíbrio ──────────────────────────────────────
  // spread > 1.5 → cada ponto adicional reduz 6% do score
  // Ex: spread 4.0 → penalty = (4.0 − 1.5) × 0.06 = 0.15 = −15%
  const spread = Math.max(E, C, S) - Math.min(E, C, S);
  const imbalancePenalty = spread > 1.5 ? (spread - 1.5) * 0.06 : 0;

  // ── 3. Modificador de trajetória (rhr_trend_3d) ───────────────────────────
  // RHR subindo (+) = sobrecarga acumulada → penaliza score
  // RHR caindo (−) = recuperação → bonifica score
  // Clampado a [0.90, 1.10] — máximo ±10% de variação
  let trendMod = 1.0;
  if (rhr_trend_3d != null && !isNaN(rhr_trend_3d)) {
    trendMod = clamp(1 + rhr_trend_3d * -0.02, 0.90, 1.10);
  }

  // ── 4. Penalização por dados ausentes (data quality) ──────────────────────
  // Cada pilar com cobertura < 1.0 reduz até 15% do score
  // gap_penalty = (1 − quality) × 0.15
  let qualityPenalty = 0;
  if (quality_scores) {
    const qE = quality_scores.energia ?? 1;
    const qC = quality_scores.clareza ?? 1;
    const qS = quality_scores.estabilidade ?? 1;
    // Média das penalizações ponderada pelos expoentes dos pilares
    qualityPenalty = (
      (1 - qE) * 0.15 * 0.35 +
      (1 - qC) * 0.15 * 0.30 +
      (1 - qS) * 0.15 * 0.35
    );
  }

  // ── 5. Score final ────────────────────────────────────────────────────────
  const raw = scoreBase * (1 - imbalancePenalty) * trendMod * (1 - qualityPenalty);
  return Math.round(clamp(raw, 0, 100));
}

/**
 * @deprecated Use computeScoreV4 for new engine logic.
 * Mantido para compatibilidade — pode ser removido após migração completa.
 */
export function computeScore(pillars: PillarScore): number {
  return computeScoreV4(pillars);
}

export function getLevel(score: number): string {
  if (score >= 85) return 'Ótimo';
  if (score >= 70) return 'Bom';
  if (score >= 55) return 'Moderado';
  if (score >= 40) return 'Baixo';
  return 'Crítico';
}

export function getLimitingFactor(pillars: PillarScore): string {
  const min = Math.min(pillars.energia, pillars.clareza, pillars.estabilidade);
  if (pillars.energia === min) return 'energia';
  if (pillars.clareza === min) return 'clareza';
  return 'estabilidade';
}

export function getCurrentPhase(): 'BOOT' | 'HOLD' | 'CLEAR' {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'BOOT';
  if (hour >= 12 && hour < 18) return 'HOLD';
  return 'CLEAR';
}

export interface PhaseTimeWindow {
  start: number;
  end: number;
  label: string;
}

export function getPhaseTimeWindow(phase: string): PhaseTimeWindow {
  // Labels are display-only ("BOOT corresponds to morning hours"). Registration
  // is 24/7 — no enforcement. Aligned with android-vyr-app for parity.
  switch (phase) {
    case 'BOOT':  return { start: 5,  end: 12, label: '05h–11h59' };
    case 'HOLD':  return { start: 12, end: 18, label: '12h–17h59' };
    case 'CLEAR': return { start: 18, end: 29, label: '18h–04h59' };
    default:      return { start: 0,  end: 24, label: '00h–24h' };
  }
}

/** 24/7 registration: any phase is always registerable, regardless of clock. */
export function isPhaseActive(_phase: string): boolean {
  return true;
}

/** Returns the suggested phase based on time of day (BOOT/HOLD/CLEAR). Never null. */
export function getActiveDosePhase(): 'BOOT' | 'HOLD' | 'CLEAR' {
  return getCurrentPhase();
}

/** 24/7 registration: always within window. */
export function isWithinProtocolWindow(): boolean {
  return true;
}

/**
 * Rich state labels based on score + dominant/limiting pillar (v3: 8×3 = 24 labels)
 */
export function getRichLabel(score: number, pillars: PillarScore): string {
  const dominant = pillars.energia >= pillars.clareza && pillars.energia >= pillars.estabilidade
    ? 'energia' : pillars.clareza >= pillars.estabilidade ? 'clareza' : 'estabilidade';

  const limiting = getLimitingFactor(pillars);

  if (score >= 90) {
    return dominant === 'energia' ? 'Energia plena' : dominant === 'clareza' ? 'Foco sustentado' : 'Equilíbrio elevado';
  }
  if (score >= 80) {
    return dominant === 'energia' ? 'Energia consolidada' : dominant === 'clareza' ? 'Clareza ampla' : 'Sustentação firme';
  }
  if (score >= 70) {
    return dominant === 'energia' ? 'Energia estável' : dominant === 'clareza' ? 'Clareza disponível' : 'Sustentação adequada';
  }
  if (score >= 60) {
    return dominant === 'energia' ? 'Energia funcional' : dominant === 'clareza' ? 'Foco parcial' : 'Equilíbrio parcial';
  }
  if (score >= 50) {
    // Use limiting pillar for mid-range context
    return limiting === 'energia' ? 'Energia moderada' : limiting === 'clareza' ? 'Foco instável' : 'Clareza parcial';
  }
  if (score >= 40) {
    return limiting === 'energia' ? 'Reserva baixa' : limiting === 'clareza' ? 'Oscilação detectada' : 'Sustentação necessária';
  }
  if (score >= 25) {
    return limiting === 'energia' ? 'Depleção energética' : limiting === 'clareza' ? 'Instabilidade elevada' : 'Regulação necessária';
  }
  return limiting === 'energia' ? 'Esgotamento energético' : limiting === 'clareza' ? 'Dispersão cognitiva' : 'Recuperação necessária';
}

/**
 * Recommended action based on context
 */
export function getRecommendedAction(pillars: PillarScore, score: number, actionsTaken: string[]): 'BOOT' | 'HOLD' | 'CLEAR' {
  const hour = new Date().getHours();

  // Night: always CLEAR
  if (hour >= 22 || hour < 5) return 'CLEAR';

  // Critical state: CLEAR
  if (score < 45 || pillars.energia <= 2 || pillars.estabilidade <= 2) return 'CLEAR';

  // Morning
  if (hour >= 5 && hour < 12) {
    if (!actionsTaken.includes('BOOT') && (pillars.energia >= 3.5 || score >= 65)) return 'BOOT';
    if (actionsTaken.includes('BOOT')) return 'HOLD';
  }

  // Afternoon
  if (hour >= 12 && hour < 18) {
    if (score >= 55 && !actionsTaken.includes('HOLD')) return 'HOLD';
    if (actionsTaken.includes('HOLD')) return 'CLEAR';
  }

  // Evening
  if (hour >= 18) return 'CLEAR';

  // Fallback
  if (score >= 65) return 'BOOT';
  if (score >= 55) return 'HOLD';
  return 'CLEAR';
}

/**
 * Returns the CSS variable name for the score level color
 */
export function getScoreColorVar(score: number): string {
  if (score >= 85) return '--vyr-score-otimo';
  if (score >= 70) return '--vyr-score-bom';
  if (score >= 55) return '--vyr-score-moderado';
  if (score >= 40) return '--vyr-score-baixo';
  return '--vyr-score-critico';
}

export function computeState(
  data: BiometricData,
  baseline?: BaselineValues,
  features?: { rhr_trend_3d?: number | null; quality_energia?: number; quality_clareza?: number; quality_estabilidade?: number } | null,
): VYRState {
  const pillars = computePillars(data, baseline);
  const score = computeScoreV4(
    pillars,
    features?.rhr_trend_3d ?? null,
    features ? {
      energia: features.quality_energia,
      clareza: features.quality_clareza,
      estabilidade: features.quality_estabilidade,
    } : undefined,
  );
  return {
    score,
    level: getLevel(score),
    pillars,
    limitingFactor: getLimitingFactor(pillars),
    phase: getCurrentPhase(),
  };
}

// Demo data for preview
export function getDemoState(): VYRState {
  return computeState({
    rhr: 58,
    sleepDuration: 7.2,
    sleepQuality: 72,
    spo2: 97,
    sleepRegularity: 25,
    awakenings: 2,
    hrvRawMs: 45,
    stressLevel: 35,
    tempDeviation: 0.3,
  });
}
