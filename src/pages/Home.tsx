import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, TrendingDown, Minus, ChevronRight, Play, AlertCircle } from 'lucide-react';
import StateRing from '@/components/StateRing';
import TransitionCard from '@/components/TransitionCard';
import SachetConfirmation from '@/components/SachetConfirmation';
import CheckpointModal from '@/components/CheckpointModal';
import NotificationBell from '@/components/NotificationBell';
import ConnectionStatusPill from '@/components/ConnectionStatusPill';
import BottomNav from '@/components/BottomNav';
import BrainLogo from '@/components/BrainLogo';
import { interpret } from '@/lib/vyr-interpreter';
import { getActiveDosePhase } from '@/lib/vyr-engine';
import { useVYRStore } from '@/hooks/useVYRStore';
// Fase activa de dose — UMA fase por janela horária
function getGreeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}

const phaseConfig: Record<string, { label: string; colorVar: string; color: string; desc: string; actionLabel: string }> = {
  BOOT: { label: 'BOOT', colorVar: '--vyr-accent-action', color: '#556B8A', desc: 'Ativação cognitiva (05h–11h59)', actionLabel: 'Clique ao tomar BOOT' },
  HOLD: { label: 'HOLD', colorVar: '--vyr-accent-transition', color: '#8F7A4A', desc: 'Sustentação cognitiva (12h–17h59)', actionLabel: 'Clique ao tomar HOLD' },
  CLEAR: { label: 'CLEAR', colorVar: '--vyr-accent-stable', color: '#4F6F64', desc: 'Recuperação cognitiva (18h–22h)', actionLabel: 'Clique ao tomar CLEAR' },
};

const pillarNames: Record<string, string> = {
  energia: 'Energia',
  clareza: 'Clareza',
  estabilidade: 'Estabilidade',
};

/* ── Expanded Pillar Card with mini-gauge ── */

function PillarCard({ name, value, description, index }: { name: string; value: number; description: string; index: number }) {
  const circleRef = useRef<SVGCircleElement>(null);
  const size = 48;
  const stroke = 3.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const arcFraction = 0.75;
  const arcLength = circumference * arcFraction;
  const progress = (value / 5) * arcLength;
  const dashOffset = arcLength - progress;

  const isCritical = value < 2.0;
  const arcColor = isCritical ? '#DC2626' : '#F59E0B';

  useEffect(() => {
    const circle = circleRef.current;
    if (!circle) return;
    circle.style.strokeDashoffset = `${arcLength}`;
    const delay = 200 + index * 100;
    setTimeout(() => {
      circle.style.transition = 'stroke-dashoffset 800ms cubic-bezier(0.4, 0, 0.2, 1)';
      circle.style.strokeDashoffset = `${dashOffset}`;
    }, delay);
  }, [value, arcLength, dashOffset, index]);

  const borderColor = isCritical && name === 'Estabilidade' ? '#1F0A0A' : '#1A1A1A';

  return (
    <div
      className="rounded-2xl p-4 flex items-center gap-4"
      style={{
        background: '#0E0E0E',
        border: `1px solid ${borderColor}`,
        animation: `slide-up 200ms ease-out ${200 + index * 100}ms both`,
      }}
    >
      <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-225deg)' }}>
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke="rgba(255,255,255,0.06)"
            strokeWidth={stroke} strokeDasharray={`${arcLength} ${circumference}`} strokeLinecap="round"
          />
          <circle
            ref={circleRef}
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke={arcColor}
            strokeWidth={stroke} strokeDasharray={`${arcLength} ${circumference}`} strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 4px ${arcColor}44)` }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm tabular-nums" style={{ fontWeight: 300, color: arcColor }}>
            {value.toFixed(1)}
          </span>
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <span className="text-sm text-[#E8E8E8]" style={{ fontWeight: 500 }}>{name}</span>
        <p className="text-xs text-[#667788] mt-0.5 leading-relaxed" style={{ fontWeight: 400 }}>{description}</p>
      </div>

      <span className="text-sm tabular-nums flex-shrink-0" style={{ fontWeight: 300, color: arcColor }}>
        {value.toFixed(1)}/5
      </span>
    </div>
  );
}

const Home = () => {
  const navigate = useNavigate();
  const store = useVYRStore();
  const { state, hasData, userName, actionsTaken, sachetConfirmation, prediction, anomaly, engineMode, dataConfidence } = store;
  const [showCheckpoint, setShowCheckpoint] = useState(false);

  const interpretation = useMemo(() => interpret(state), [state]);

  // Delta (today vs yesterday)
  const delta = useMemo(() => {
    if (store.historyByDay.length < 2) return 0;
    const today = new Date().toISOString().split('T')[0];
    const todayEntry = store.historyByDay.find((h) => h.day === today);
    const yesterdayEntry = store.historyByDay.find((h) => h.day !== today);
    if (todayEntry && yesterdayEntry) return todayEntry.score - yesterdayEntry.score;
    return 0;
  }, [store.historyByDay]);

  // Confirmar sachet: registar acção
  const handleConfirmSachet = useCallback(async (phase: string) => {
    try {
      await store.logAction(phase);
    } catch (err) {
      console.error('[home] Failed to log action:', err);
    }
  }, [store]);

  // Limiting factor info
  const limitingPillarName = pillarNames[state.limitingFactor] || state.limitingFactor;
  const limitingValue = state.pillars[state.limitingFactor as keyof typeof state.pillars];
  const limitingLevel = limitingValue < 2.0 ? 'NÍVEL CRÍTICO' : limitingValue < 3.0 ? 'NÍVEL BAIXO' : 'NÍVEL MODERADO';

  // Fase activa de dose (única por janela horária)
  const activeDose = getActiveDosePhase();
  const doseRegistered = activeDose ? actionsTaken.includes(activeDose) : false;

  return (
    <div className="min-h-dvh bg-background pb-24 safe-area-top" style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2.5">
          <BrainLogo size={32} />
          <span className="text-sm text-foreground" style={{ fontWeight: 500 }}>
            {getGreeting()}{userName ? `, ${userName}` : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ConnectionStatusPill />
          <NotificationBell />
        </div>
      </header>

      {/* ── 1. VYR State Gauge ── */}
      <div className="flex flex-col items-center pt-2" style={{ animation: 'fade-in 150ms ease-out' }}>
        <div onClick={() => hasData && navigate('/state')} className={hasData ? 'cursor-pointer' : ''}>
          <StateRing
            score={state.score}
            stateLabel={hasData ? interpretation.stateLabel : 'Sem dados'}
            level={state.level}
          />
        </div>

        {hasData && (
          <div className="flex items-center gap-1 mt-3 animate-delta-pulse">
            {delta > 0 ? (
              <TrendingUp size={14} className="text-vyr-positive" />
            ) : delta < 0 ? (
              <TrendingDown size={14} className="text-vyr-caution" />
            ) : (
              <Minus size={14} className="text-vyr-text-muted" />
            )}
            <span className={`text-xs ${delta > 0 ? 'text-vyr-positive' : delta < 0 ? 'text-vyr-caution' : 'text-vyr-text-muted'}`} style={{ fontWeight: 500 }}>
              {delta > 0 ? '+' : ''}{delta} pts vs ontem
            </span>
          </div>
        )}
      </div>

      <div className="px-5 mt-6 space-y-4">
        {!hasData ? (
          <>
            {['Energia', 'Clareza', 'Estabilidade'].map((label, i) => (
              <div
                key={label}
                className="rounded-2xl p-4 flex items-center gap-4"
                style={{ background: '#0E0E0E', border: '1px solid #1A1A1A' }}
              >
                <span className="text-lg text-foreground w-8 text-center" style={{ fontWeight: 300 }}>0</span>
                <div className="flex-1">
                  <span className="text-sm text-foreground" style={{ fontWeight: 500 }}>{label}</span>
                  <p className="text-xs text-[#667788]" style={{ fontWeight: 400 }}>Aguardando leitura.</p>
                </div>
                <span className="text-xs text-[#667788]" style={{ fontWeight: 300 }}>0/5</span>
              </div>
            ))}
            <div className="rounded-2xl p-4" style={{ background: '#0D0D0D', border: '1px solid #1A1A1A' }}>
              <div className="flex items-start gap-3">
                <AlertCircle size={20} className="text-[#F59E0B] mt-0.5 flex-shrink-0" />
                <div>
                  <h3 className="text-sm text-foreground" style={{ fontWeight: 500 }}>Diagnóstico do sistema</h3>
                  <p className="text-xs text-[#667788] mt-1 leading-relaxed" style={{ fontWeight: 400 }}>
                    Conecte um wearable para que o VYR possa calcular seu estado cognitivo.
                  </p>
                </div>
              </div>
              <p className="text-xs text-[#667788] text-center mt-4" style={{ fontWeight: 400 }}>Sem dados disponíveis.</p>
            </div>
          </>
        ) : (
          <>
            {/* ── Badge Confidence / Calibrando (E.2) ── */}
            {(dataConfidence?.confidence_level === 'low' || dataConfidence?.confidence_level === 'medium' || engineMode === 'bootstrap' || engineMode === 'adaptive') && (
              <div
                className="flex items-center justify-center gap-2 py-2 rounded-xl"
                style={{
                  background: dataConfidence?.confidence_level === 'low' ? '#1A0F00' : '#0F172A',
                  border: `1px solid ${dataConfidence?.confidence_level === 'low' ? '#3D2000' : '#1E3A5F'}`,
                }}
              >
                <div
                  className="w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ background: dataConfidence?.confidence_level === 'low' ? '#FBBF24' : '#60A5FA' }}
                />
                <span className="text-[10px] uppercase" style={{
                  color: dataConfidence?.confidence_level === 'low' ? '#FBBF24' : '#60A5FA',
                  letterSpacing: '0.15em', fontWeight: 500,
                }}>
                  {dataConfidence?.display_label
                    ? dataConfidence.display_label
                    : dataConfidence?.confidence_level === 'low'
                      ? 'Calibrando · Coletando mais dados'
                      : dataConfidence?.confidence_level === 'medium'
                        ? 'Dados parciais · Confiança média'
                        : engineMode === 'bootstrap'
                          ? 'Calibrando · Coletando dados iniciais'
                          : 'Adaptando · Modelo em calibração'}
                </span>
              </div>
            )}
            {/* ── 2. Card "Hoje isso significa" ── */}
            <button
              onClick={() => navigate('/state')}
              className="w-full rounded-2xl p-4 text-left transition-transform active:scale-[0.98]"
              style={{ background: '#0C1220', border: '1px solid #1E293B' }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3
                    className="text-xs uppercase"
                    style={{ fontWeight: 500, color: '#4B7BEC', letterSpacing: '0.16em' }}
                  >
                    Hoje isso significa
                  </h3>
                  <p className="text-xs mt-1" style={{ fontWeight: 400, color: '#445566' }}>
                    O que o sistema projeta para o seu dia.
                  </p>
                </div>
                <ChevronRight size={18} style={{ color: '#445566' }} />
              </div>
            </button>


            {/* ── Previsão de Amanhã (F6) ── */}
            {prediction && (
              <div
                className="rounded-2xl p-4"
                style={{ background: '#0D1B12', border: '1px solid #1A3020' }}
              >
                <div className="flex items-center justify-between mb-2">
                  <h3
                    className="text-xs uppercase"
                    style={{ fontWeight: 500, color: '#34D399', letterSpacing: '0.16em' }}
                  >
                    Previsão de amanhã
                  </h3>
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full"
                    style={{
                      background: prediction.confidence_level === 'high' ? '#052e16' : prediction.confidence_level === 'medium' ? '#1c1917' : '#0f172a',
                      color: prediction.confidence_level === 'high' ? '#34D399' : prediction.confidence_level === 'medium' ? '#FBBF24' : '#60A5FA',
                      fontWeight: 500,
                    }}
                  >
                    {prediction.confidence_level === 'high' ? 'Alta confiança' : prediction.confidence_level === 'medium' ? 'Confiança média' : 'Estimativa'}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className="text-4xl font-light tabular-nums"
                    style={{ color: '#34D399', letterSpacing: '-0.03em' }}
                  >
                    {prediction.score}
                  </span>
                  <div>
                    <p className="text-xs" style={{ color: '#4B7A5A', fontWeight: 400 }}>
                      {prediction.score > state.score
                        ? `+${prediction.score - state.score} pontos vs hoje`
                        : prediction.score < state.score
                        ? `${prediction.score - state.score} pontos vs hoje`
                        : 'Estável em relação a hoje'}
                    </p>
                    <p className="text-[10px] mt-0.5" style={{ color: '#2D5040', fontWeight: 300 }}>
                      Baseado em HRV, sono e tendência de FC
                    </p>
                  </div>
                </div>
              </div>
            )}
            {/* ── 3. Índices (Energia / Clareza / Estabilidade) ── */}
            <PillarCard
              name="Energia"
              value={state.pillars.energia}
              description={interpretation.pillarDescriptions.energia}
              index={0}
            />
            <PillarCard
              name="Clareza"
              value={state.pillars.clareza}
              description={interpretation.pillarDescriptions.clareza}
              index={1}
            />
            <PillarCard
              name="Estabilidade"
              value={state.pillars.estabilidade}
              description={interpretation.pillarDescriptions.estabilidade}
              index={2}
            />

            {/* ── Alerta de Anomalia (F6 — Isolation Forest) ── */}
            {anomaly && (
              <div
                className="rounded-2xl p-4"
                style={{
                  background: anomaly.severity === 'high' ? '#1A0000' : '#1A0F00',
                  border: `1px solid ${anomaly.severity === 'high' ? '#3D0000' : '#3D2000'}`,
                }}
              >
                <div className="flex items-start gap-3">
                  <AlertCircle
                    size={18}
                    className="flex-shrink-0 mt-0.5"
                    style={{ color: anomaly.severity === 'high' ? '#EF4444' : '#F97316' }}
                  />
                  <div>
                    <h4
                      className="text-xs uppercase"
                      style={{
                        fontWeight: 500,
                        color: anomaly.severity === 'high' ? '#EF4444' : '#F97316',
                        letterSpacing: '0.14em',
                      }}
                    >
                      {anomaly.severity === 'high' ? 'Padrão incomum detectado' : 'Variação detectada'}
                    </h4>
                    <p className="text-xs mt-1.5 leading-relaxed" style={{ color: '#99AABB', fontWeight: 400 }}>
                      {Object.keys(anomaly.features_flagged).length > 0
                        ? `Marcadores fora do padrão: ${Object.keys(anomaly.features_flagged).join(', ')}.`
                        : 'Combinação incomum de biomarcadores detectada.'}
                    </p>
                  </div>
                </div>
              </div>
            )}
            {/* ── 4. Leitura do sistema (unified) ── */}
            <div className="rounded-2xl p-4" style={{ background: '#0D0D0D', border: '1px solid #1A1A1A' }}>
              <div className="flex items-start gap-3">
                <AlertCircle size={18} className="flex-shrink-0 mt-0.5" style={{ color: '#F59E0B' }} />
                <div className="min-w-0">
                  <h4
                    className="text-xs uppercase"
                    style={{ fontWeight: 500, color: '#F59E0B', letterSpacing: '0.14em' }}
                  >
                    Leitura do sistema
                  </h4>
                  <p className="text-xs mt-2 leading-relaxed" style={{ fontWeight: 400, color: '#99AABB' }}>
                    {interpretation.whyScore}
                  </p>
                  <p className="text-xs mt-1.5 leading-relaxed" style={{ fontWeight: 400, color: '#778899' }}>
                    {interpretation.dayRisk}
                  </p>
                </div>
              </div>

              <div className="mt-3 pt-3" style={{ borderTop: '1px solid #171717' }}>
                <p
                  className="text-[10px] uppercase text-center"
                  style={{ fontWeight: 500, color: '#556677', letterSpacing: '0.14em' }}
                >
                  FATOR LIMITANTE: {limitingPillarName.toUpperCase()} · {limitingLevel}
                </p>
              </div>
            </div>

            {/* TransitionCard */}
            <TransitionCard
              state={state}
              actionsTaken={actionsTaken}
              onStartTransition={store.activateTransition}
            />

            {/* Protocol CTA */}
            {activeDose && !doseRegistered && (
              <>
                <div className="rounded-2xl p-4" style={{ background: '#0E0E0E', border: '1px solid #1A1A1A' }}>
                  <h3
                    className="text-xs uppercase mb-1"
                    style={{ fontWeight: 500, color: '#667788', letterSpacing: '0.14em' }}
                  >
                    Protocolo {activeDose}
                  </h3>
                  <p className="text-xs" style={{ fontWeight: 400, color: '#667788' }}>
                    Registre quando tomar o sachet desta fase.
                  </p>
                </div>

                <button
                  onClick={() => handleConfirmSachet(activeDose)}
                  className="w-full rounded-xl py-4 flex flex-col items-center gap-1 text-sm text-foreground transition-transform active:scale-[0.98]"
                  style={{
                    fontWeight: 500,
                    background: phaseConfig[activeDose]?.color ?? 'hsl(var(--primary))',
                    boxShadow: `0 4px 20px -4px ${phaseConfig[activeDose]?.color ?? 'hsl(var(--primary))'}66`,
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Play size={16} fill="currentColor" />
                    <span>Protocolo {activeDose}</span>
                  </div>
                  <span className="text-[10px] opacity-70">
                    {phaseConfig[activeDose]?.actionLabel ?? 'Clique ao tomar ' + activeDose}
                  </span>
                </button>
              </>
            )}
          </>
        )}
      </div>

      <BottomNav />

      {sachetConfirmation.show && (
        <SachetConfirmation
          phase={sachetConfirmation.phase}
          onDismiss={store.dismissConfirmation}
          onAddObservation={store.dismissConfirmation}
        />
      )}

      {showCheckpoint && (
        <CheckpointModal
          onClose={() => setShowCheckpoint(false)}
          onSubmit={store.addCheckpoint}
        />
      )}
    </div>
  );
};

export default Home;
