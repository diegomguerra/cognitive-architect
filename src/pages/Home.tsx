import { useMemo, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, TrendingDown, Minus, ChevronRight, Play, Activity } from 'lucide-react';
import StateRing from '@/components/StateRing';
import PillarRing from '@/components/PillarRing';
import ContextCard from '@/components/ContextCard';
import InsightCard from '@/components/InsightCard';
import CognitiveWindowCard from '@/components/CognitiveWindowCard';
import TransitionCard from '@/components/TransitionCard';
import SachetConfirmation from '@/components/SachetConfirmation';
import NotificationBell from '@/components/NotificationBell';
import ConnectionStatusPill from '@/components/ConnectionStatusPill';
import BottomNav from '@/components/BottomNav';
import BrainLogo from '@/components/BrainLogo';
import { getCurrentPhase } from '@/lib/vyr-engine';
import type { VYRState } from '@/lib/vyr-engine';
import { interpret } from '@/lib/vyr-interpreter';
import { retryOnAuthErrorLabeled, requireValidUserId } from '@/lib/auth-session';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const emptyState: VYRState = {
  score: 0,
  level: 'Crítico',
  pillars: { energia: 0, clareza: 0, estabilidade: 0 },
  limitingFactor: 'energia',
  phase: getCurrentPhase(),
};

function getGreeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}

const phaseConfig = {
  BOOT: { label: 'BOOT', time: '05h–11h', colorVar: '--vyr-accent-action', desc: 'Ativação cognitiva', actionLabel: 'Clique ao tomar BOOT' },
  HOLD: { label: 'HOLD', time: '11h–17h', colorVar: '--vyr-accent-transition', desc: 'Sustentação cognitiva', actionLabel: 'Clique ao tomar HOLD' },
  CLEAR: { label: 'CLEAR', time: '17h–22h+', colorVar: '--vyr-accent-stable', desc: 'Recuperação cognitiva', actionLabel: 'Clique ao tomar CLEAR' },
};

const Home = () => {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<VYRState>(emptyState);
  const [hasData, setHasData] = useState(false);
  const [delta, setDelta] = useState(0);
  const [userName, setUserName] = useState('');
  const [actionsTaken, setActionsTaken] = useState<string[]>([]);
  const [showSachet, setShowSachet] = useState(false);
  const [sachetPhase, setSachetPhase] = useState('BOOT');

  useEffect(() => {
    if (!session?.user?.id) return;
    const userId = session.user.id;
    const today = new Date().toISOString().split('T')[0];

    const loadData = async () => {
      // Load state, name, and actions in parallel
      const [stateRes, nameRes, actionsRes, yesterdayRes] = await Promise.all([
        supabase.from('computed_states').select('score, level, pillars, phase').eq('user_id', userId).eq('day', today).maybeSingle(),
        supabase.from('participantes').select('nome_publico').eq('user_id', userId).maybeSingle(),
        supabase.from('action_logs').select('action_type').eq('user_id', userId).eq('day', today),
        supabase.from('computed_states').select('score').eq('user_id', userId).eq('day', new Date(Date.now() - 86400000).toISOString().split('T')[0]).maybeSingle(),
      ]);

      // Name
      if (nameRes.data?.nome_publico) {
        setUserName(nameRes.data.nome_publico.split(' ')[0]);
      }

      // Actions taken today
      if (actionsRes.data) {
        setActionsTaken(actionsRes.data.map((a) => a.action_type));
      }

      // State
      if (stateRes.data?.score != null) {
        const p = stateRes.data.pillars as any;
        const pillars = {
          energia: p?.energia ?? 0,
          clareza: p?.clareza ?? 0,
          estabilidade: p?.estabilidade ?? 0,
        };
        const min = Math.min(pillars.energia, pillars.clareza, pillars.estabilidade);
        const limitingFactor = pillars.energia === min ? 'energia' : pillars.clareza === min ? 'clareza' : 'estabilidade';

        setState({
          score: stateRes.data.score,
          level: stateRes.data.level || 'Crítico',
          pillars,
          limitingFactor,
          phase: (stateRes.data.phase as VYRState['phase']) || getCurrentPhase(),
        });
        setHasData(true);

        if (yesterdayRes.data?.score != null) {
          setDelta(stateRes.data.score - yesterdayRes.data.score);
        }
      }
    };

    loadData();
  }, [session?.user?.id]);

  const interpretation = useMemo(() => interpret(state), [state]);
  const phase = phaseConfig[state.phase];

  const handleConfirmSachet = useCallback(async () => {
    try {
      const userId = await requireValidUserId();
      const today = new Date().toISOString().split('T')[0];

      await retryOnAuthErrorLabeled(async () => {
        const result = await supabase.from('action_logs').insert({
          user_id: userId,
          day: today,
          action_type: state.phase,
          payload: { confirmed_at: new Date().toISOString() },
        }).select();
        return result;
      });

      setSachetPhase(state.phase);
      setShowSachet(true);
      setActionsTaken((prev) => [...prev, state.phase]);
    } catch (err) {
      console.error('[home] Failed to log action:', err);
    }
  }, [state.phase]);

  const handleStartTransition = useCallback(async (targetPhase: string) => {
    try {
      const userId = await requireValidUserId();
      const today = new Date().toISOString().split('T')[0];

      await retryOnAuthErrorLabeled(async () => {
        const result = await supabase.from('action_logs').insert({
          user_id: userId,
          day: today,
          action_type: targetPhase,
          payload: { transition: true, confirmed_at: new Date().toISOString() },
        }).select();
        return result;
      });

      setSachetPhase(targetPhase);
      setShowSachet(true);
      setActionsTaken((prev) => [...prev, targetPhase]);
    } catch (err) {
      console.error('[home] Failed to log transition:', err);
    }
  }, []);

  return (
    <div className="min-h-dvh bg-background pb-24 safe-area-top">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2.5">
          <BrainLogo size={32} />
          <span className="text-sm text-foreground font-medium">
            {getGreeting()}{userName ? `, ${userName}` : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ConnectionStatusPill />
          <NotificationBell />
        </div>
      </header>

      {/* State Ring */}
      <div className="flex flex-col items-center pt-2" style={{ animation: 'fade-in 150ms ease-out' }}>
        <div onClick={() => hasData && navigate('/state')} className={hasData ? 'cursor-pointer' : ''}>
          <StateRing
            score={state.score}
            stateLabel={hasData ? interpretation.stateLabel : 'Sem dados'}
            level={state.level}
          />
        </div>

        {/* Delta */}
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

        {/* Pillar Rings */}
        {hasData && (
          <div className="flex items-center justify-center gap-8 mt-6">
            <PillarRing value={state.pillars.energia} label="Energia" colorVar="--vyr-energia" index={0} />
            <PillarRing value={state.pillars.clareza} label="Clareza" colorVar="--vyr-clareza" index={1} />
            <PillarRing value={state.pillars.estabilidade} label="Estabilidade" colorVar="--vyr-estabilidade" index={2} />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="px-5 mt-6 space-y-4">
        {!hasData ? (
          /* Empty state */
          <>
            {/* Pillar cards (empty) */}
            {['Energia', 'Clareza', 'Estabilidade'].map((label) => (
              <div key={label} className="rounded-2xl bg-card border border-border p-4 flex items-center gap-4">
                <span className="text-lg font-mono font-bold text-foreground w-8 text-center">0</span>
                <div className="flex-1">
                  <span className="text-sm font-medium text-foreground">{label}</span>
                  <p className="text-xs text-muted-foreground">Aguardando leitura.</p>
                </div>
                <span className="text-xs font-mono text-muted-foreground">0/5</span>
              </div>
            ))}

            {/* Diagnostic */}
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
          </>
        ) : (
          /* Full state */
          <>
            {/* Action Button */}
            <button
              onClick={handleConfirmSachet}
              className="w-full rounded-xl py-4 flex flex-col items-center gap-1 text-sm font-medium text-foreground transition-transform active:scale-[0.98]"
              style={{
                background: `hsl(var(${phase.colorVar}))`,
                boxShadow: `0 4px 20px -4px hsl(var(${phase.colorVar}) / 0.4)`,
              }}
            >
              <div className="flex items-center gap-2">
                <Play size={16} fill="currentColor" />
                <span>Protocolo {phase.label}</span>
              </div>
              <span className="text-[10px] opacity-70">{phase.actionLabel}</span>
            </button>
            <p className="text-[10px] text-muted-foreground text-center -mt-2">
              Registre aqui quando tomar o sachet da fase {phase.label}.
            </p>

            {/* Context Card */}
            <ContextCard items={interpretation.contextItems} />

            {/* Cognitive Window */}
            <CognitiveWindowCard
              score={state.score}
              clareza={state.pillars.clareza}
              estabilidade={state.pillars.estabilidade}
            />

            {/* Insight: System Reading */}
            <InsightCard type="insight" title="Leitura do sistema" description={interpretation.systemReading} />

            {/* Today Means (clickable) */}
            <button
              onClick={() => navigate('/state')}
              className="w-full rounded-2xl bg-card p-4 text-left transition-transform active:scale-[0.98]"
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs uppercase tracking-[0.15em] text-vyr-text-muted font-medium">
                  Hoje isso significa
                </h3>
                <ChevronRight size={16} className="text-vyr-text-muted" />
              </div>
              <div className="space-y-2">
                {interpretation.todayMeans.map((item, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: 'hsl(var(--vyr-accent-action))' }} />
                    <span className="text-sm text-secondary-foreground">{item}</span>
                  </div>
                ))}
              </div>
            </button>

            {/* Transition Card */}
            <TransitionCard
              state={state}
              actionsTaken={actionsTaken}
              onStartTransition={handleStartTransition}
            />

            {/* Recommendations */}
            {interpretation.todayMeans.map((item, i) => (
              <InsightCard
                key={i}
                type={i === 0 ? 'positive' : 'warning'}
                title={i === 0 ? 'Capacidade do dia' : 'Recomendação'}
                description={item}
              />
            ))}
          </>
        )}
      </div>

      <BottomNav />

      {/* Sachet Confirmation Modal */}
      {showSachet && (
        <SachetConfirmation
          phase={sachetPhase}
          onDismiss={() => setShowSachet(false)}
          onAddObservation={() => {
            setShowSachet(false);
            navigate('/labs?tab=Percepções');
          }}
        />
      )}
    </div>
  );
};

export default Home;
