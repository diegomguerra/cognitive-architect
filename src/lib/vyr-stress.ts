/**
 * vyr-stress.ts — Cálculo de estresse com derivação completa (F6 enhancement)
 *
 * Filosofia: nunca retornar 50 (neutro) se houver qualquer sinal disponível.
 *
 * Cascata de derivação:
 *   1. HRV real do wearable → z-score ln(RMSSD) com baseline individual
 *   2. HRV derivado de FC → z-score com baseline populacional (menos preciso)
 *   3. Sem HRV → score composto via RHR + sono + RR (proxy de estresse)
 *
 * A derivação de HRV via FC (pseudo-RMSSD) existe em healthkit.ts.
 * Este módulo recebe o resultado já derivado — não deriva novamente.
 */

export interface StressInput {
  // HRV (real ou derivado de FC — ambos válidos)
  avgHrv?: number;              // ms (RMSSD ou SDNN)
  hrvIsReal?: boolean;          // true = wearable direto, false = derivado de FC

  // Contexto fisiológico — usados mesmo sem HRV
  avgRhr?: number;              // bpm
  sleepHours?: number;          // horas
  sleepQuality?: number;        // 0-100
  avgRespiratoryRate?: number;  // breaths/min
  skinTempDelta?: number;       // °C delta da basal noturna

  // Baseline individual (30d) — usa população se ausente
  baseline?: {
    rhr?: { mean: number; std: number } | null;
    sleep?: { mean: number; std: number } | null;
    hrvLn?: { mean: number; std: number } | null;
  };
}

export interface StressResult {
  level: number;           // 0-100
  confidence: 'high' | 'medium' | 'low';
  source: 'hrv_real' | 'hrv_derived' | 'rhr_sleep_rr' | 'fallback';
  components: {
    hrv?: number;          // contribuição HRV (0-100)
    rhr?: number;          // contribuição RHR (0-100)
    sleep?: number;        // contribuição sono (0-100)
    rr?: number;           // contribuição respiração (0-100)
    skinTemp?: number;     // contribuição temperatura (0-100)
  };
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// Fallbacks populacionais
const POP = {
  rhr:   { mean: 65,          std: 10  },
  sleep: { mean: 7.0,         std: 1.0 },
  hrvLn: { mean: Math.log(40), std: 0.4 },  // ln(40) ≈ 3.689
};

/**
 * Score de estresse via HRV — caminho primário.
 * Retorna null se avgHrv não disponível.
 */
function stressFromHRV(
  avgHrv: number,
  baseline?: StressInput['baseline'],
): number {
  const lnHrv = Math.log(clamp(avgHrv, 5, 250));
  const bl = baseline?.hrvLn ?? POP.hrvLn;
  const z = clamp((lnHrv - bl.mean) / Math.max(bl.std, 0.01), -3, 3);
  // z=-3 → stress 100, z=0 → 50, z=+3 → 0
  return Math.round(((-z + 3) / 6) * 100);
}

/**
 * Score de estresse via RHR — proxy quando HRV ausente.
 * Eleva muito acima do baseline → estresse.
 * Abaixo do baseline → recuperação/baixo estresse.
 */
function stressFromRHR(
  avgRhr: number,
  baseline?: StressInput['baseline'],
): number {
  const bl = baseline?.rhr ?? POP.rhr;
  const z = clamp((avgRhr - bl.mean) / Math.max(bl.std, 0.01), -2.5, 2.5);
  // z=+2.5 (RHR muito alto) → stress ~83, z=0 → 50, z=-2.5 → ~17
  return Math.round(((z + 2.5) / 5) * 100);
}

/**
 * Score de estresse via sono — proxy secundário.
 * Déficit de sono eleva estresse.
 */
function stressFromSleep(
  sleepHours: number,
  sleepQuality?: number,
  baseline?: StressInput['baseline'],
): number {
  const blMean = baseline?.sleep?.mean ?? POP.sleep.mean;
  const blStd  = baseline?.sleep?.std  ?? POP.sleep.std;

  // Déficit de horas
  const deficit = blMean - sleepHours;
  const deficitScore = clamp(50 + deficit * 12, 0, 100); // +1h déficit = +12 pontos de estresse

  // Qualidade de sono (se disponível)
  if (sleepQuality != null && sleepQuality > 0) {
    const qualityScore = clamp(100 - sleepQuality, 0, 100); // qualidade 100 = stress 0
    // Média ponderada: duração tem mais peso que qualidade
    return Math.round(deficitScore * 0.6 + qualityScore * 0.4);
  }

  return Math.round(deficitScore);
}

/**
 * Modificador via taxa respiratória.
 * RR > 18 breaths/min em repouso → elevação de estresse.
 */
function rrModifier(avgRR: number): number {
  if (avgRR <= 15) return -5;      // abaixo do normal → menos estresse
  if (avgRR <= 18) return 0;       // normal → sem modificação
  return clamp((avgRR - 18) * 2, 0, 12); // > 18 → +até 12 pontos
}

/**
 * Modificador via temperatura da pele (skin temp delta).
 * Delta positivo elevado → ativação fisiológica → mais estresse.
 */
function skinTempModifier(delta: number): number {
  if (Math.abs(delta) < 0.2) return 0;
  if (delta > 0) return clamp(delta * 5, 0, 8);  // febre/ativação → +estresse
  return clamp(delta * 3, -5, 0);                // hipotermia leve → -estresse
}

/**
 * Função principal de cálculo de estresse.
 * Nunca retorna 50 se houver qualquer dado disponível.
 *
 * Confiança:
 *   high   = HRV real + contexto completo
 *   medium = HRV derivado OU HRV real sem contexto
 *   low    = apenas RHR + sono (sem HRV de qualquer forma)
 */
export function computeStressV4(input: StressInput): StressResult {
  const components: StressResult['components'] = {};
  let base = 50;
  let source: StressResult['source'] = 'fallback';
  let confidence: StressResult['confidence'] = 'low';

  // ── Caminho 1: HRV disponível (real ou derivado) ──────────────────────────
  if (input.avgHrv != null && input.avgHrv > 0) {
    const hrvScore = stressFromHRV(input.avgHrv, input.baseline);
    components.hrv = hrvScore;
    base = hrvScore;
    source = input.hrvIsReal !== false ? 'hrv_real' : 'hrv_derived';
    confidence = source === 'hrv_real' ? 'high' : 'medium';
  }

  // ── Caminho 2: Sem HRV — RHR como sinal primário ─────────────────────────
  else if (input.avgRhr != null && input.avgRhr > 0) {
    const rhrScore = stressFromRHR(input.avgRhr, input.baseline);
    components.rhr = rhrScore;
    base = rhrScore;
    source = 'rhr_sleep_rr';
    confidence = 'low';

    // Sono como segundo sinal quando não tem HRV
    if (input.sleepHours != null && input.sleepHours > 0) {
      const sleepScore = stressFromSleep(input.sleepHours, input.sleepQuality, input.baseline);
      components.sleep = sleepScore;
      // Fusão: RHR 60% + sono 40%
      base = Math.round(rhrScore * 0.6 + sleepScore * 0.4);
      confidence = 'medium';  // dois sinais = mais confiável
    }
  }

  // ── Caminho 3: Só sono disponível ─────────────────────────────────────────
  else if (input.sleepHours != null && input.sleepHours > 0) {
    const sleepScore = stressFromSleep(input.sleepHours, input.sleepQuality, input.baseline);
    components.sleep = sleepScore;
    base = sleepScore;
    source = 'rhr_sleep_rr';
    confidence = 'low';
  }

  // ── Sem nenhum sinal — retorna 50 (único caso legítimo) ──────────────────
  else {
    return { level: 50, confidence: 'low', source: 'fallback', components: {} };
  }

  // ── Modificadores contextuais (aplicados em todos os caminhos) ────────────

  // RHR como modificador quando HRV é o sinal primário
  if (source !== 'rhr_sleep_rr' && input.avgRhr != null) {
    const bl = input.baseline?.rhr ?? POP.rhr;
    const delta = input.avgRhr - bl.mean;
    if (delta > 3) {
      const mod = clamp((delta - 3) * 2, 0, 15);
      components.rhr = Math.round(50 + delta * 5);
      base = clamp(base + mod, 0, 100);
    }
  }

  // Sono como modificador quando HRV é primário (mas RHR não)
  if (source !== 'rhr_sleep_rr' && input.sleepHours != null) {
    const blMean = input.baseline?.sleep?.mean ?? POP.sleep.mean;
    const deficit = blMean - input.sleepHours;
    if (deficit > 0.5) {
      const mod = clamp(deficit * 4, 0, 10);
      components.sleep = stressFromSleep(input.sleepHours, input.sleepQuality, input.baseline);
      base = clamp(base + mod, 0, 100);
    }
  }

  // RR como modificador universal
  if (input.avgRespiratoryRate != null) {
    const mod = rrModifier(input.avgRespiratoryRate);
    if (mod !== 0) {
      components.rr = Math.round(50 + (input.avgRespiratoryRate - 15) * 4);
      base = clamp(base + mod, 0, 100);
    }
  }

  // Skin temp como modificador (sinal suave)
  if (input.skinTempDelta != null) {
    const mod = skinTempModifier(input.skinTempDelta);
    if (mod !== 0) {
      components.skinTemp = Math.round(50 + input.skinTempDelta * 15);
      base = clamp(base + mod, 0, 100);
    }
  }

  return {
    level: Math.round(clamp(base, 0, 100)),
    confidence,
    source,
    components,
  };
}

/**
 * Wrapper de compatibilidade para o código existente.
 * Drop-in replacement para computeStressLevel() em healthkit.ts.
 */
export function computeStressLevelV4(
  avgHrv: number | undefined,
  opts: {
    avgRhr?: number;
    sleepHours?: number;
    sleepQuality?: number;
    avgRespiratoryRate?: number;
    skinTempDelta?: number;
    hrvIsReal?: boolean;
    baseline?: StressInput['baseline'];
  } = {},
): number {
  return computeStressV4({
    avgHrv,
    ...opts,
  }).level;
}
