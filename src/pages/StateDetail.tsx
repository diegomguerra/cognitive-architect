import { useMemo, useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import StateRing from '@/components/StateRing';
import PillarRing from '@/components/PillarRing';
import InsightCard from '@/components/InsightCard';
import BottomNav from '@/components/BottomNav';
import { getCurrentPhase } from '@/lib/vyr-engine';
import type { VYRState } from '@/lib/vyr-engine';
import { interpret } from '@/lib/vyr-interpreter';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const emptyState: VYRState = {
  score: 0, level: 'Crítico',
  pillars: { energia: 0, clareza: 0, estabilidade: 0 },
  limitingFactor: 'energia', phase: getCurrentPhase(),
};

const StateDetail = () => {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [state, setState] = useState<VYRState>(emptyState);
  const [hasData, setHasData] = useState(false);

  useEffect(() => {
    if (!session?.user?.id) return;
    const today = new Date().toISOString().split('T')[0];

    supabase.from('computed_states').select('score, level, pillars, phase')
      .eq('user_id', session.user.id).eq('day', today).maybeSingle()
      .then(({ data }) => {
        if (data?.score != null) {
          const p = data.pillars as any;
          const pillars = { energia: p?.energia ?? 0, clareza: p?.clareza ?? 0, estabilidade: p?.estabilidade ?? 0 };
          const min = Math.min(pillars.energia, pillars.clareza, pillars.estabilidade);
          setState({
            score: data.score, level: data.level || 'Crítico', pillars,
            limitingFactor: pillars.energia === min ? 'energia' : pillars.clareza === min ? 'clareza' : 'estabilidade',
            phase: (data.phase as VYRState['phase']) || getCurrentPhase(),
          });
          setHasData(true);
        }
      });
  }, [session?.user?.id]);

  const interpretation = useMemo(() => interpret(state), [state]);

  const pillarData = [
    { key: 'energia', label: 'Energia', colorVar: '--vyr-energia' },
    { key: 'clareza', label: 'Clareza', colorVar: '--vyr-clareza' },
    { key: 'estabilidade', label: 'Estabilidade', colorVar: '--vyr-estabilidade' },
  ];

  return (
    <div className="min-h-dvh bg-background pb-24 safe-area-top">
      <header className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft size={20} />
          </button>
          <h1 className="font-mono font-bold text-foreground text-sm">Estado atual</h1>
        </div>
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Nível: {state.level}
        </span>
      </header>

      <div className="flex flex-col items-center pt-2">
        <StateRing score={state.score} stateLabel={hasData ? interpretation.stateLabel : 'Sem dados'} level={state.level} />
      </div>

      {/* Pillar Details */}
      <div className="px-5 mt-6">
        <div className="rounded-2xl bg-card border border-border p-4 space-y-0">
          {pillarData.map(({ key, label, colorVar }, i) => (
            <div key={key}>
              {i > 0 && <div className="h-px bg-border my-4" />}
              <div className="flex items-center gap-4">
                <PillarRing value={state.pillars[key as keyof typeof state.pillars]} label="" colorVar={colorVar} index={i} />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">{label}</span>
                    <span className="text-sm font-mono text-muted-foreground">
                      {state.pillars[key as keyof typeof state.pillars].toFixed(1)}/5
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {interpretation.pillarDescriptions[key]}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="px-5 mt-4 space-y-4">
        <InsightCard type="positive" title="Diagnóstico do sistema" description={interpretation.systemDiagnosis} />

        <p className="text-xs text-muted-foreground text-center px-4">
          Esta análise é baseada nos dados biométricos mais recentes e no seu histórico pessoal.
        </p>
      </div>

      <BottomNav />
    </div>
  );
};

export default StateDetail;
