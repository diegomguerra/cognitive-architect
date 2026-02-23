import { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import StateRing from '@/components/StateRing';
import PillarRing from '@/components/PillarRing';
import ContextCard from '@/components/ContextCard';
import InsightCard from '@/components/InsightCard';
import BottomNav from '@/components/BottomNav';
import BrainLogo from '@/components/BrainLogo';
import { getDemoState } from '@/lib/vyr-engine';
import { interpret } from '@/lib/vyr-interpreter';

const Home = () => {
  const state = useMemo(() => getDemoState(), []);
  const interpretation = useMemo(() => interpret(state), [state]);
  const delta = 4; // demo delta

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
        <StateRing score={state.score} stateLabel={interpretation.stateLabel} level={state.level} />

        {/* Delta */}
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

        {/* Pillar Rings */}
        <div className="flex items-center justify-center gap-8 mt-6">
          <PillarRing value={state.pillars.energia} label="Energia" colorVar="--vyr-energia" index={0} />
          <PillarRing value={state.pillars.clareza} label="Clareza" colorVar="--vyr-clareza" index={1} />
          <PillarRing value={state.pillars.estabilidade} label="Estabilidade" colorVar="--vyr-estabilidade" index={2} />
        </div>
      </div>

      {/* Content */}
      <div className="px-5 mt-8 space-y-4">
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
        <InsightCard
          type="insight"
          title="Leitura do sistema"
          description={interpretation.systemReading}
        />
        {interpretation.todayMeans.map((item, i) => (
          <InsightCard
            key={i}
            type={i === 0 ? 'positive' : 'warning'}
            title={i === 0 ? 'Hoje isso significa' : 'Recomendação'}
            description={item}
          />
        ))}
      </div>

      <BottomNav />
    </div>
  );
};

export default Home;
