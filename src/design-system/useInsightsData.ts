import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Phase 2 + 2.5 — consome contributors do Edge Function vyr-compute-state v12.
// Edge function retorna scores 0-100 + contributors null-tolerant + editorial server-side.
// Client não deriva mais nada — só renderiza.

export type Contributor = {
  name: string;
  rawValue: string;
  score: number | null;
  weight: number;
  displayOrder: number;
  qualityNote?: string;
};

export type IndexType = 'energia' | 'clareza' | 'estabilidade';

export type InsightsData = {
  day: string;
  vyrState: number | null;
  pillars: { energia: number | null; clareza: number | null; estabilidade: number | null };
  editorial: Record<'vyr_state' | IndexType, { heading: string; body: string }>;
  contributors: Record<'vyr_state' | IndexType, Contributor[]>;
  cause?: { contributorName: string; explanation: string };
  last7Days: { d: string; score: number | null }[];
  freshness: { lastSeenAt: string | null; minutesSinceLast: number | null };
};

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

        const today = new Date().toISOString().slice(0, 10);

        // 1. Chama Edge Function v12 pra dia atual
        const { data: efData, error: efError } = await supabase.functions.invoke('vyr-compute-state', {
          body: { day: today },
        });

        if (efError) {
          // Pode ser 404 "No biometric data" — fallback pro último computed_state
          const { data: fallback } = await supabase
            .from('computed_states')
            .select('day,score,pillars')
            .eq('user_id', user.id)
            .order('day', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (!fallback) throw new Error('Sem dados — sincronize o anel.');
          if (!cancelled) {
            setData({
              day: fallback.day as string,
              vyrState: Number(fallback.score),
              pillars: {
                energia: Math.round(((fallback.pillars as Record<string, number>)?.energia ?? 0) * 20),
                clareza: Math.round(((fallback.pillars as Record<string, number>)?.clareza ?? 0) * 20),
                estabilidade: Math.round(((fallback.pillars as Record<string, number>)?.estabilidade ?? 0) * 20),
              },
              editorial: {
                vyr_state: { heading: 'Estado registrado', body: 'Dados do último cálculo disponível.' },
                energia: { heading: '', body: '' },
                clareza: { heading: '', body: '' },
                estabilidade: { heading: '', body: '' },
              },
              contributors: { vyr_state: [], energia: [], clareza: [], estabilidade: [] },
              last7Days: [],
              freshness: { lastSeenAt: null, minutesSinceLast: null },
            });
          }
          return;
        }

        // 2. Busca histórico 7 dias pra sparkline
        const { data: history } = await supabase
          .from('computed_states')
          .select('day,score')
          .eq('user_id', user.id)
          .order('day', { ascending: false })
          .limit(7);

        // 3. Freshness — última leitura BLE do device
        const { data: device } = await supabase
          .from('devices')
          .select('last_seen_at')
          .eq('user_id', user.id)
          .order('last_seen_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const minutesSinceLast = device?.last_seen_at
          ? Math.floor((Date.now() - new Date(device.last_seen_at as string).getTime()) / 60_000)
          : null;

        const result: InsightsData = {
          day: efData.day,
          vyrState: efData.vyrState,
          pillars: {
            energia: efData.energia,
            clareza: efData.clareza,
            estabilidade: efData.estabilidade,
          },
          editorial: efData.editorial,
          contributors: efData.contributors,
          cause: efData.cause,
          last7Days: (history ?? []).slice().reverse().map((r) => ({
            d: new Date(r.day as string).toLocaleDateString('pt-BR', { weekday: 'short' }).slice(0, 3).toUpperCase(),
            score: r.score != null ? Number(r.score) : null,
          })),
          freshness: {
            lastSeenAt: (device?.last_seen_at as string) ?? null,
            minutesSinceLast,
          },
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

/** Helper pra freshness UI. Retorna "Atualizado há 2h" ou "Sem dados há 5d". */
export function freshnessLabel(min: number | null): string | undefined {
  if (min == null) return undefined;
  if (min < 5) return 'Atualizado agora';
  if (min < 60) return `Atualizado há ${min}min`;
  if (min < 1440) return `Atualizado há ${Math.floor(min / 60)}h`;
  const days = Math.floor(min / 1440);
  return `Sem dados há ${days}d`;
}
