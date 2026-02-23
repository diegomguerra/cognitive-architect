import { useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import StateRing from '@/components/StateRing';
import PillarRing from '@/components/PillarRing';
import BottomNav from '@/components/BottomNav';
import { getDemoState } from '@/lib/vyr-engine';
import { interpret } from '@/lib/vyr-interpreter';

const StateDetail = () => {
  const navigate = useNavigate();
  const state = useMemo(() => getDemoState(), []);
  const interpretation = useMemo(() => interpret(state), [state]);

  return (
    <div className="min-h-dvh bg-background pb-24 safe-area-top">
      <header className="flex items-center gap-3 px-5 py-4">
        <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={20} />
        </button>
        <h1 className="font-mono font-bold text-foreground text-sm">Estado Cognitivo</h1>
      </header>

      <div className="flex flex-col items-center pt-4">
        <StateRing score={state.score} stateLabel={interpretation.stateLabel} level={state.level} />

        <div className="flex items-center justify-center gap-8 mt-6">
          <PillarRing value={state.pillars.energia} label="Energia" colorVar="--vyr-energia" index={0} />
          <PillarRing value={state.pillars.clareza} label="Clareza" colorVar="--vyr-clareza" index={1} />
          <PillarRing value={state.pillars.estabilidade} label="Estabilidade" colorVar="--vyr-estabilidade" index={2} />
        </div>
      </div>

      <div className="px-5 mt-8 space-y-4">
        <div className="rounded-2xl bg-card p-4">
          <h3 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium mb-2">Leitura do Sistema</h3>
          <p className="text-sm text-secondary-foreground">{interpretation.systemReading}</p>
        </div>

        <div className="rounded-2xl bg-card p-4">
          <h3 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium mb-2">Janela Cognitiva</h3>
          <p className="text-sm text-secondary-foreground">{interpretation.cognitiveWindow}</p>
        </div>

        {interpretation.contextItems.map((item, i) => (
          <div key={i} className="rounded-2xl bg-card p-4 flex items-start gap-3">
            <div className={`w-2 h-2 rounded-full mt-1.5 ${
              item.status === 'favorable' ? 'bg-[hsl(var(--vyr-positive))]' :
              item.status === 'attention' ? 'bg-[hsl(var(--vyr-caution))]' :
              'bg-muted-foreground'
            }`} />
            <p className="text-sm text-secondary-foreground">{item.text}</p>
          </div>
        ))}
      </div>

      <BottomNav />
    </div>
  );
};

export default StateDetail;
