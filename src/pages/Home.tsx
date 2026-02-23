import { useMemo, useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Minus, Activity } from 'lucide-react';
import StateRing from '@/components/StateRing';
import PillarRing from '@/components/PillarRing';
import ContextCard from '@/components/ContextCard';
import InsightCard from '@/components/InsightCard';
import BottomNav from '@/components/BottomNav';
import BrainLogo from '@/components/BrainLogo';
import { computeState, getCurrentPhase } from '@/lib/vyr-engine';
import type { VYRState } from '@/lib/vyr-engine';
import { interpret } from '@/lib/vyr-interpreter';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const emptyState: VYRState = {
  score: 0,
  level: 'Crítico',
  pillars: { energia: 0, clareza: 0, estabilidade: 0 },
  limitingFactor: 'energia',
  phase: getCurrentPhase(),
};

const Home = () => {
  const { session } = useAuth();
  const [state, setState] = useState<VYRState>(emptyState);
  const [hasData, setHasData] = useState(false);
  const [delta, setDelta] = useState(0);

  useEffect(() => {
    const loadTodayState = async () => {
      if (!session?.user?.id) return;

      const today = new Date().toISOString().split('T')[0];
      const { data } = await supabase
        .from('computed_states')
        .select('score, level, pillars, phase')
        .eq('user_id', session.user.id)
        .eq('day', today)
        .maybeSingle();

      if (data && data.score != null) {
        const pillars = data.pillars as any;
        const loadedState: VYRState = {
          score: data.score,
          level: data.level || 'Crítico',
          pillars: {
            energia: pillars?.energia ?? 0,
            clareza: pillars?.clareza ?? 0,
            estabilidade: pillars?.estabilidade ?? 0,
          },
          limitingFactor: 'energia',
          phase: (data.phase as VYRState['phase']) || getCurrentPhase(),
        };
        // Recalculate limiting factor
        const min = Math.min(loadedState.pillars.energia, loadedState.pillars.clareza, loadedState.pillars.estabilidade);
        if (loadedState.pillars.energia === min) loadedState.limitingFactor = 'energia';
        else if (loadedState.pillars.clareza === min) loadedState.limitingFactor = 'clareza';
        else loadedState.limitingFactor = 'estabilidade';

        setState(loadedState);
        setHasData(true);

        // Get yesterday's score for delta
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const { data: yesterdayData } = await supabase
          .from('computed_states')
          .select('score')
          .eq('user_id', session.user.id)
          .eq('day', yesterday.toISOString().split('T')[0])
          .maybeSingle();

        if (yesterdayData?.score != null) {
          setDelta(data.score! - yesterdayData.score);
        }
      }
    };

    loadTodayState();
  }, [session?.user?.id]);

  const interpretation = useMemo(() => interpret(state), [state]);

  const phaseConfig = {
    BOOT: { label: 'BOOT', time: '05h–11h', color: '--vyr-accent-action' },
    HOLD: { label: 'HOLD', time: '11h–17h', color: '--vyr-accent-transition' },
    CLEAR: { label: 'CLEAR', time: '17h–22h+', color: '--vyr-accent-stable' },
  };
  const phase = phaseConfig[state.phase];

  return (
    <div className="min-h-dvh bg-background pb-24 safe-area-top">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2.5">
          <BrainLogo size={32} />
          <span className="font-mono font-bold tracking-wide text-foreground text-sm">VYR</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-mono uppercase tracking-[0.15em] px-2 py-1 rounded-full"
            style={{
              color: `hsl(var(${phase.color}))`,
              background: `hsl(var(${phase.color}) / 0.1)`,
            }}
          >
            {phase.label} {phase.time}
          </span>
        </div>
      </header>

      {/* State Ring */}
      <div className="flex flex-col items-center pt-4" style={{ animation: 'fade-in 150ms ease-out' }}>
        <StateRing
          score={state.score}
          stateLabel={hasData ? interpretation.stateLabel : 'Sem dados'}
          level={state.level}
        />

        {/* Delta - only show if has data */}
        {hasData && (
          <div className="flex items-center gap-1 mt-3 animate-delta-pulse">
            {delta > 0 ? (
              <TrendingUp size={14} className="text-vyr-positive" />
            ) : delta < 0 ? (
              <TrendingDown size={14} className="text-vyr-caution" />
            ) : (
              <Minus size={14} className="text-vyr-text-muted" />
            )}
            <span className={`text-xs font-medium ${delta > 0 ? 'text-vyr-positive' : delta < 0 ? 'text-vyr-caution' : 'text-vyr-text-muted'}`}>
              {delta > 0 ? '+' : ''}{delta} pts vs ontem
            </span>
          </div>
        )}
      </div>

      {/* Pillar Cards */}
      <div className="px-5 mt-6 space-y-3">
        {[
          { key: 'energia', label: 'Energia', value: state.pillars.energia },
          { key: 'clareza', label: 'Clareza', value: state.pillars.clareza },
          { key: 'estabilidade', label: 'Estabilidade', value: state.pillars.estabilidade },
        ].map(({ key, label, value }) => (
          <div key={key} className="rounded-2xl bg-card border border-border p-4 flex items-center gap-4">
            <span className="text-lg font-mono font-bold text-foreground w-8 text-center">
              {hasData ? value.toFixed(1) : '0'}
            </span>
            <div className="flex-1">
              <span className="text-sm font-medium text-foreground">{label}</span>
              <p className="text-xs text-muted-foreground">
                {hasData ? `${value.toFixed(1)}/5` : 'Aguardando leitura.'}
              </p>
            </div>
            <span className="text-xs font-mono text-muted-foreground">
              {hasData ? `${value.toFixed(1)}/5` : '0/5'}
            </span>
          </div>
        ))}
      </div>

      {/* Diagnostic / Content */}
      <div className="px-5 mt-4 space-y-4">
        {!hasData ? (
          <div className="rounded-2xl bg-card border border-border p-4">
            <div className="flex items-start gap-3">
              <Activity size={20} className="text-primary mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="text-sm font-semibold text-foreground">Diagnóstico do sistema</h3>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Conecte um wearable para que o VYR possa calcular seu estado cognitivo.
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground text-center mt-4">Sem dados disponíveis.</p>
          </div>
        ) : (
          <>
            {/* Action Button */}
            <button
              className="w-full rounded-xl py-4 flex items-center justify-center gap-2 text-sm font-medium text-foreground transition-transform active:scale-[0.98]"
              style={{
                background: `hsl(var(${phase.color}))`,
                boxShadow: `0 4px 20px -4px hsl(var(${phase.color}) / 0.4)`,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
              Protocolo {phase.label}
            </button>

            {/* Context */}
            <ContextCard items={interpretation.contextItems} />

            {/* Cognitive Window */}
            <div className="rounded-2xl bg-card p-4">
              <h3 className="text-xs uppercase tracking-[0.15em] text-vyr-text-muted font-medium mb-2">
                Janela cognitiva
              </h3>
              <p className="text-sm text-vyr-text-secondary">{interpretation.cognitiveWindow}</p>
            </div>

            {/* Insights */}
            <InsightCard type="insight" title="Leitura do sistema" description={interpretation.systemReading} />
            {interpretation.todayMeans.map((item, i) => (
              <InsightCard
                key={i}
                type={i === 0 ? 'positive' : 'warning'}
                title={i === 0 ? 'Hoje isso significa' : 'Recomendação'}
                description={item}
              />
            ))}
          </>
        )}
      </div>

      <BottomNav />
    </div>
  );
};

export default Home;
