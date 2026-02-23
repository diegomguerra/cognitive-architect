import { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import MiniScoreRing from '@/components/MiniScoreRing';
import EvolutionChart from '@/components/EvolutionChart';

interface DayData {
  day: string;
  score: number;
  level: string;
  pillars: { energia: number; clareza: number; estabilidade: number };
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
}

function getDayNote(score: number): string {
  if (score >= 80) return 'Dia favorável, boa capacidade cognitiva.';
  if (score >= 65) return 'Dia consistente, sem quedas abruptas.';
  if (score >= 50) return 'Ajustes ao longo do dia.';
  return 'Dia de recuperação necessária.';
}

const HistoryTab = () => {
  const { session } = useAuth();
  const [days, setDays] = useState<DayData[]>([]);

  useEffect(() => {
    if (!session?.user?.id) return;

    supabase.from('computed_states')
      .select('day, score, level, pillars')
      .eq('user_id', session.user.id)
      .order('day', { ascending: false })
      .limit(30)
      .then(({ data }) => {
        if (data) {
          setDays(data.map((d) => ({
            day: d.day,
            score: d.score ?? 0,
            level: d.level ?? 'Crítico',
            pillars: d.pillars as any ?? { energia: 0, clareza: 0, estabilidade: 0 },
          })));
        }
      });
  }, [session?.user?.id]);

  if (days.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">Sem histórico disponível ainda.</p>
      </div>
    );
  }

  const chartData = [...days].reverse().map((d) => ({
    date: new Date(d.day + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short' }),
    score: d.score,
    energia: d.pillars.energia,
    clareza: d.pillars.clareza,
    estabilidade: d.pillars.estabilidade,
  }));

  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="space-y-4">
      {/* Chart */}
      <EvolutionChart data={chartData} />

      {/* Day List */}
      <div className="space-y-3">
        {days.map((d, i) => {
          const isToday = d.day === today;
          const prevScore = i < days.length - 1 ? days[i + 1].score : null;
          const delta = prevScore != null ? d.score - prevScore : 0;

          return (
            <div
              key={d.day}
              className="rounded-2xl bg-card p-4 flex items-center gap-4"
              style={isToday ? { border: '1px solid hsl(var(--vyr-accent-action) / 0.2)' } : { border: '1px solid hsl(var(--border))' }}
            >
              <MiniScoreRing score={d.score} size={48} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{formatDate(d.day)}</span>
                  {isToday && (
                    <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded text-primary bg-primary/10">Hoje</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{getDayNote(d.score)}</p>
              </div>
              {delta !== 0 && (
                <div className="flex items-center gap-0.5">
                  {delta > 0 ? (
                    <TrendingUp size={12} className="text-vyr-positive" />
                  ) : (
                    <TrendingDown size={12} className="text-vyr-caution" />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default HistoryTab;
