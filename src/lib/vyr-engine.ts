// VYR State Engine — Core Algorithm

export interface BiometricData {
  rhr?: number;           // Resting Heart Rate (bpm)
  sleepDuration?: number; // hours
  sleepQuality?: number;  // 0-100
  spo2?: number;          // 90-100
  sleepRegularity?: number; // deviation in minutes
  awakenings?: number;    // count
  hrvIndex?: number;      // ms (SDNN)
  stressLevel?: number;   // 0-100
  tempDeviation?: number; // °C deviation from baseline
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

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const normalize = (v: number, min: number, max: number) => clamp((v - min) / (max - min), 0, 1) * 5;
const invertNormalize = (v: number, min: number, max: number) => clamp(1 - (v - min) / (max - min), 0, 1) * 5;

export function computePillars(data: BiometricData): PillarScore {
  // Energia: RHR(inv), sleep duration, sleep quality, SpO2
  const energiaComponents: number[] = [];
  const energiaWeights: number[] = [];
  
  if (data.rhr != null) { energiaComponents.push(invertNormalize(data.rhr, 40, 100)); energiaWeights.push(2.5); }
  if (data.sleepDuration != null) { energiaComponents.push(normalize(data.sleepDuration, 4, 9)); energiaWeights.push(2.5); }
  if (data.sleepQuality != null) { energiaComponents.push(normalize(data.sleepQuality, 0, 100)); energiaWeights.push(2.5); }
  if (data.spo2 != null) { energiaComponents.push(normalize(data.spo2, 90, 100)); energiaWeights.push(2.5); }

  // Clareza: sleep regularity(inv), sleep quality, awakenings(inv)
  const clarezaComponents: number[] = [];
  const clarezaWeights: number[] = [];
  
  if (data.sleepRegularity != null) { clarezaComponents.push(invertNormalize(data.sleepRegularity, 0, 120)); clarezaWeights.push(2.5); }
  if (data.sleepQuality != null) { clarezaComponents.push(normalize(data.sleepQuality, 0, 100)); clarezaWeights.push(2.5); }
  if (data.awakenings != null) { clarezaComponents.push(invertNormalize(data.awakenings, 0, 10)); clarezaWeights.push(2.5); }

  // Estabilidade: HRV, stress(inv), temp deviation
  const estabComponents: number[] = [];
  const estabWeights: number[] = [];
  
  if (data.hrvIndex != null) { 
    const hrvNorm = clamp(Math.log(data.hrvIndex + 1) / Math.log(201) * 5, 0, 5);
    estabComponents.push(hrvNorm); estabWeights.push(2.0); 
  }
  if (data.stressLevel != null) { estabComponents.push(invertNormalize(data.stressLevel, 0, 100)); estabWeights.push(2.0); }
  if (data.tempDeviation != null) { estabComponents.push(invertNormalize(Math.abs(data.tempDeviation), 0, 2)); estabWeights.push(2.0); }

  const weightedAvg = (vals: number[], weights: number[]) => {
    if (vals.length === 0) return 3; // neutral fallback
    const totalW = weights.reduce((a, b) => a + b, 0);
    return vals.reduce((sum, v, i) => sum + v * weights[i], 0) / totalW;
  };

  return {
    energia: clamp(weightedAvg(energiaComponents, energiaWeights), 0, 5),
    clareza: clamp(weightedAvg(clarezaComponents, clarezaWeights), 0, 5),
    estabilidade: clamp(weightedAvg(estabComponents, estabWeights), 0, 5),
  };
}

export function computeScore(pillars: PillarScore): number {
  const avg = (pillars.energia + pillars.clareza + pillars.estabilidade) / 3;
  const min = Math.min(pillars.energia, pillars.clareza, pillars.estabilidade);
  return Math.round((avg * 0.6 + min * 0.4) / 5 * 100);
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
  if (hour >= 5 && hour < 11) return 'BOOT';
  if (hour >= 11 && hour < 17) return 'HOLD';
  return 'CLEAR';
}

export function computeState(data: BiometricData): VYRState {
  const pillars = computePillars(data);
  const score = computeScore(pillars);
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
    hrvIndex: 45,
    stressLevel: 35,
    tempDeviation: 0.3,
  });
}
