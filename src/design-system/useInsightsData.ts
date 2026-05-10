import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

// VYR State engine retorna 0-5 nos pillars; precisamos converter pra 0-100 pra
// usar com as bandas Optimal/Good/Fair/Pay attention.
function pillar5to100(v: number): number {
  return Math.round(Math.max(0, Math.min(5, v)) * 20);
}

export type Contributor = {
  name: string;
  rawValue: string;
  score: number; // 0-100
};

export type IndexType = 'energia' | 'clareza' | 'estabilidade';

export type InsightsData = {
  day: string;
  vyrState: number;
  pillars: { energia: number; clareza: number; estabilidade: number };
  level: string;
  phase: string;
  editorial: { heading: string; body: string };
  contributors: Record<IndexType, Contributor[]>;
  last7Days: { d: string; score: number }[];
  raw: Record<string, unknown>;
};

const HEADING_BY_BAND: Record<string, string[]> = {
  opt: ['Você está em pico cognitivo.', 'Estado ótimo, aproveite a janela.', 'Tudo alinhado hoje.'],
  good: ['Estado funcional, com folga.', 'Dia operacional.', 'Bom equilíbrio geral.'],
  fair: ['Sinal misto. Atenção aos eixos.', 'Recuperação parcial.', 'Olhe os contribuidores em vermelho.'],
  low: ['Hoje pede recuperação ativa.', 'Reduza o ritmo, priorize o sono.', 'Modo descanso recomendado.'],
};

function bandFromScore(s: number): string {
  if (s >= 85) return 'opt';
  if (s >= 70) return 'good';
  if (s >= 60) return 'fair';
  return 'low';
}

function pickHeading(score: number, day: string, userId: string): string {
  const band = bandFromScore(score);
  const list = HEADING_BY_BAND[band] || HEADING_BY_BAND.fair;
  const seed = (userId + day).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return list[seed % list.length];
}

const BODY_BY_BAND: Record<string, string> = {
  opt: 'Janela de pico — execute o que mais demanda foco e tome decisões importantes hoje.',
  good: 'Pode operar normalmente. Algumas variáveis estão abaixo do baseline mas dentro de tolerância.',
  fair: 'Sinal misto entre os pilares. Reduza estímulos e priorize uma pausa intencional.',
  low: 'Recuperação ativa recomendada — sono mais cedo, hidratação, sem cafeína no fim do dia.',
};

// Deriva contributors de cada pillar a partir do raw_input do computed_states.
function deriveContributors(raw: Record<string, unknown>): Record<IndexType, Contributor[]> {
  const r = raw as {
    rhr?: number; hr_avg?: number; hrv_rmssd?: number; hrv_index?: number;
    stress_level?: number; sleep_duration_hours?: number; sleep_quality?: number;
    spo2?: number; steps?: number; skin_temp_delta?: number; respiratory_rate?: number;
    active_energy_kcal?: number; basal_energy_kcal?: number;
  };

  const fmt = (v: number | undefined, unit: string, digits = 0): string =>
    v == null ? '—' : `${v.toFixed(digits)}${unit}`;

  // ENERGIA — funções fisiológicas e prontidão física
  const energia: Contributor[] = [];
  if (r.rhr != null) energia.push({ name: 'FC repouso', rawValue: `${r.rhr} bpm`, score: scoreRhr(r.rhr) });
  if (r.hr_avg != null) energia.push({ name: 'FC média', rawValue: `${r.hr_avg} bpm`, score: scoreHrAvg(r.hr_avg) });
  if (r.sleep_duration_hours != null) energia.push({ name: 'Duração do sono', rawValue: hms(r.sleep_duration_hours), score: scoreSleepDur(r.sleep_duration_hours) });
  if (r.spo2 != null) energia.push({ name: 'SpO₂', rawValue: `${r.spo2}%`, score: scoreSpo2(r.spo2) });
  if (r.active_energy_kcal != null) energia.push({ name: 'Energia ativa', rawValue: `${Math.round(r.active_energy_kcal)} kcal`, score: scoreActiveKcal(r.active_energy_kcal) });

  // CLAREZA — sistema nervoso, recuperação cognitiva
  const clareza: Contributor[] = [];
  if (r.hrv_rmssd != null) clareza.push({ name: 'HRV (RMSSD)', rawValue: `${Math.round(r.hrv_rmssd)} ms`, score: scoreHrv(r.hrv_rmssd) });
  else if (r.hrv_index != null) clareza.push({ name: 'HRV índice', rawValue: `${Math.round(r.hrv_index)}`, score: r.hrv_index });
  if (r.stress_level != null) clareza.push({ name: 'Estresse', rawValue: `${r.stress_level}`, score: 100 - r.stress_level });
  if (r.sleep_quality != null) clareza.push({ name: 'Qualidade do sono', rawValue: `${Math.round(r.sleep_quality)}`, score: r.sleep_quality });
  if (r.respiratory_rate != null) clareza.push({ name: 'Frequência respiratória', rawValue: `${r.respiratory_rate.toFixed(1)} rpm`, score: scoreRespRate(r.respiratory_rate) });

  // ESTABILIDADE — autonômico, regularidade, temperatura
  const estabilidade: Contributor[] = [];
  if (r.hrv_rmssd != null) estabilidade.push({ name: 'HRV baseline', rawValue: `${Math.round(r.hrv_rmssd)} ms`, score: scoreHrv(r.hrv_rmssd) });
  if (r.skin_temp_delta != null) estabilidade.push({ name: 'Δ temperatura', rawValue: `${r.skin_temp_delta > 0 ? '+' : ''}${r.skin_temp_delta.toFixed(2)}°C`, score: scoreTempDelta(r.skin_temp_delta) });
  if (r.respiratory_rate != null) estabilidade.push({ name: 'Frequência respiratória', rawValue: `${r.respiratory_rate.toFixed(1)} rpm`, score: scoreRespRate(r.respiratory_rate) });
  if (r.stress_level != null) estabilidade.push({ name: 'Estresse', rawValue: `${r.stress_level}`, score: 100 - r.stress_level });

  return { energia, clareza, estabilidade };
}

// ── score helpers (heurísticas conservadoras) ──
function clamp(n: number) { return Math.max(0, Math.min(100, Math.round(n))); }
function scoreRhr(v: number) { if (v <= 50) return 95; if (v <= 60) return 85; if (v <= 70) return 70; if (v <= 80) return 55; return 35; }
function scoreHrAvg(v: number) { if (v < 65) return 90; if (v < 75) return 80; if (v < 85) return 65; if (v < 95) return 50; return 35; }
function scoreSleepDur(h: number) { if (h >= 7 && h <= 9) return 95; if (h >= 6 && h < 7) return 75; if (h >= 5 && h < 6) return 60; return 40; }
function scoreSpo2(v: number) { if (v >= 97) return 95; if (v >= 95) return 80; if (v >= 92) return 60; return 40; }
function scoreActiveKcal(v: number) { if (v >= 500) return 90; if (v >= 300) return 75; if (v >= 150) return 60; return 45; }
function scoreHrv(ms: number) { if (ms >= 60) return 90; if (ms >= 40) return 75; if (ms >= 25) return 60; return 45; }
function scoreRespRate(rpm: number) { if (rpm >= 12 && rpm <= 16) return 90; if (rpm >= 10 && rpm <= 18) return 70; return 50; }
function scoreTempDelta(d: number) { const a = Math.abs(d); if (a <= 0.2) return 95; if (a <= 0.4) return 75; if (a <= 0.6) return 55; return 35; }
function hms(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h${m > 0 ? ` ${m}m` : ''}`;
}

export function useInsightsData() {
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Usuário não autenticado');

        // Pega ÚLTIMO computed_state disponível (não força hoje — pode ser ontem)
        const { data: rows, error: e1 } = await supabase
          .from('computed_states')
          .select('day,score,level,phase,pillars,raw_input')
          .eq('user_id', user.id)
          .order('day', { ascending: false })
          .limit(7);
        if (e1) throw e1;
        if (!rows || rows.length === 0) throw new Error('Sem dados de VYR State ainda. Sincronize o anel ou faça login no app por alguns dias.');

        const latest = rows[0];
        const score = Number(latest.score);
        const pillars = (latest.pillars as { energia: number; clareza: number; estabilidade: number }) || { energia: 0, clareza: 0, estabilidade: 0 };
        const raw = (latest.raw_input as Record<string, unknown>) || {};

        const result: InsightsData = {
          day: latest.day as string,
          vyrState: score,
          pillars: {
            energia: pillar5to100(pillars.energia ?? 0),
            clareza: pillar5to100(pillars.clareza ?? 0),
            estabilidade: pillar5to100(pillars.estabilidade ?? 0),
          },
          level: (latest.level as string) || '',
          phase: (latest.phase as string) || '',
          editorial: {
            heading: pickHeading(score, latest.day as string, user.id),
            body: BODY_BY_BAND[bandFromScore(score)],
          },
          contributors: deriveContributors(raw),
          last7Days: rows.slice().reverse().map((r) => ({
            d: new Date(r.day as string).toLocaleDateString('pt-BR', { weekday: 'short' }).slice(0, 3).toUpperCase(),
            score: Number(r.score),
          })),
          raw,
        };

        if (!cancelled) setData(result);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, []);

  return { data, loading, error };
}
