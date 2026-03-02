import { useState, useEffect, useMemo } from 'react';
import { Info, Zap, Eye, Moon, Clock, Check, Lock, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useVYRStore } from '@/hooks/useVYRStore';
import { isPhaseActive, getPhaseTimeWindow } from '@/lib/vyr-engine';
import { recomputeStateWithPerceptions, computeDayMeanFromPhases } from '@/lib/vyr-recompute';
import type { PhaseValues } from '@/lib/vyr-recompute';
import { toast } from 'sonner';

const phases = [
  { key: 'BOOT', label: 'Boot', sub: '05h–11h59', icon: Zap },
  { key: 'HOLD', label: 'Hold', sub: '12h–17h59', icon: Eye },
  { key: 'CLEAR', label: 'Clear', sub: '18h–22h', icon: Moon },
] as const;

const phaseDescriptions: Record<string, string> = {
  BOOT: 'BOOT — Manhã · Ativação',
  HOLD: 'HOLD — Tarde · Sustentação',
  CLEAR: 'CLEAR — Noite · Recuperação',
};

const sliders = [
  { key: 'foco', label: 'FOCO', desc: 'Como está sua capacidade de concentração?' },
  { key: 'clareza', label: 'CLAREZA', desc: 'Sua mente está clara ou confusa?' },
  { key: 'energia', label: 'ENERGIA', desc: 'Qual seu nível de energia física?' },
  { key: 'estabilidade', label: 'ESTABILIDADE', desc: 'Como está sua estabilidade emocional?' },
];

interface ReviewEntry {
  day: string;
  focus_score: number | null;
  clarity_score: number | null;
  energy_score: number | null;
  mood_score: number | null;
  notes: string | null;
}

const PerceptionsTab = () => {
  const { session } = useAuth();
  const { checkpoints, perceptionsDone, getPhasePerceptionValues, logPerception, refresh } = useVYRStore();
  const [showInfo, setShowInfo] = useState(true);
  const [selectedPhase, setSelectedPhase] = useState<'BOOT' | 'HOLD' | 'CLEAR' | null>(null);
  const [expandedPhase, setExpandedPhase] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState<Record<string, number>>(
    Object.fromEntries(sliders.map((s) => [s.key, 5]))
  );
  const [history, setHistory] = useState<ReviewEntry[]>([]);

  const allPhasesDone = phases.every((p) => perceptionsDone.includes(p.key));
  const clearDone = perceptionsDone.includes('CLEAR');

  // Auto-select the current active phase that hasn't been recorded yet
  useEffect(() => {
    if (selectedPhase) return;
    const active = phases.find((p) => isPhaseActive(p.key) && !perceptionsDone.includes(p.key));
    if (active) setSelectedPhase(active.key as any);
  }, [perceptionsDone, selectedPhase]);

  // Load history only when CLEAR is done
  useEffect(() => {
    if (!session?.user?.id || !clearDone) return;
    supabase.from('daily_reviews').select('day, focus_score, clarity_score, energy_score, mood_score, notes')
      .eq('user_id', session.user.id).order('day', { ascending: false }).limit(14)
      .then(({ data }) => { if (data) setHistory(data); });
  }, [session?.user?.id, clearDone]);

  // Compute day mean when all 3 phases are done
  useEffect(() => {
    if (!allPhasesDone) return;
    const allValues: Record<string, PhaseValues> = {};
    for (const p of phases) {
      const vals = getPhasePerceptionValues(p.key);
      if (vals) allValues[p.key] = vals as PhaseValues;
    }
    if (Object.keys(allValues).length === 3) {
      computeDayMeanFromPhases(allValues)
        .then(() => refresh())
        .catch((err) => console.warn('[perceptions] Day mean failed:', err));
    }
  }, [allPhasesDone, getPhasePerceptionValues, refresh]);

  const handleChange = (key: string, val: number) => {
    setValues((prev) => ({ ...prev, [key]: val }));
  };

  const handlePhaseClick = (phaseKey: string) => {
    const isDone = perceptionsDone.includes(phaseKey);
    if (isDone) {
      // Toggle expand to show saved values
      setExpandedPhase((prev) => prev === phaseKey ? null : phaseKey);
      return;
    }

    if (!isPhaseActive(phaseKey)) {
      const window = getPhaseTimeWindow(phaseKey);
      toast.error(`${phaseKey} disponível no horário ${window.label}`);
      return;
    }

    setSelectedPhase(phaseKey as any);
    setExpandedPhase(null);
    setValues(Object.fromEntries(sliders.map((s) => [s.key, 5])));
  };

  const handleSubmit = async () => {
    if (!selectedPhase) return;
    setSaving(true);
    try {
      // 1. Log perception to action_logs
      await logPerception(selectedPhase, values);

      // 2. Recompute VYR State with current values
      try {
        await recomputeStateWithPerceptions({
          energy: values.energia,
          clarity: values.clareza,
          focus: values.foco,
          stability: values.estabilidade,
        });
      } catch (err) {
        console.warn('[perceptions] Recompute failed:', err);
      }

      toast.success(`${selectedPhase} registrado`);

      // 3. Select next available phase
      const nextPhase = phases.find(
        (p) => !perceptionsDone.includes(p.key) && p.key !== selectedPhase && isPhaseActive(p.key)
      );
      setSelectedPhase(nextPhase ? (nextPhase.key as any) : null);
      setValues(Object.fromEntries(sliders.map((s) => [s.key, 5])));
    } catch (err) {
      console.error('[perceptions] Save failed:', err);
      toast.error('Erro ao salvar percepção');
    } finally {
      setSaving(false);
    }
  };

  const getPhaseStatus = (phaseKey: string) => {
    if (perceptionsDone.includes(phaseKey)) return 'done';
    if (isPhaseActive(phaseKey)) return 'active';
    return 'locked';
  };

  return (
    <div className="space-y-4">
      {/* Tutorial */}
      {showInfo && (
        <div className="rounded-2xl bg-card border border-border p-4" style={{ borderColor: 'hsl(var(--vyr-accent-action) / 0.2)' }}>
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              <Info size={16} className="text-muted-foreground" />
              <span className="text-sm font-semibold text-foreground">Como funciona</span>
            </div>
            <button onClick={() => setShowInfo(false)} className="text-xs text-muted-foreground hover:text-foreground">Fechar</button>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            Registre suas percepções em cada fase do dia. O VYR combina{' '}
            <span className="text-foreground font-medium">dados biométricos</span> com suas{' '}
            <span className="text-foreground font-medium">percepções subjetivas</span> para calibrar seu estado cognitivo.
          </p>
          <div className="flex justify-center gap-6 mb-3">
            {phases.map(({ key, label, sub, icon: Icon }) => (
              <div key={key} className="flex flex-col items-center gap-1.5">
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                  <Icon size={18} className="text-muted-foreground" />
                </div>
                <span className="text-xs font-semibold text-foreground">{label}</span>
                <span className="text-[10px] text-muted-foreground">{sub}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Phase Selector */}
      <div className="rounded-2xl bg-card border border-border p-4">
        <h3 className="text-xs uppercase tracking-[0.15em] font-semibold text-foreground mb-3">
          Performance Cognitiva
        </h3>

        <div className="flex gap-2 mb-4">
          {phases.map(({ key, label, icon: Icon }) => {
            const status = getPhaseStatus(key);
            const isSelected = selectedPhase === key && status === 'active';
            const isExpanded = expandedPhase === key;

            return (
              <button
                key={key}
                onClick={() => handlePhaseClick(key)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  isSelected ? 'bg-foreground text-background'
                  : status === 'done' ? 'bg-muted/80 text-foreground'
                  : status === 'locked' ? 'bg-muted/40 text-muted-foreground'
                  : 'bg-muted text-muted-foreground'
                }`}
              >
                {status === 'done' ? (
                  <Check size={12} className="text-vyr-positive" />
                ) : status === 'locked' ? (
                  <Lock size={12} />
                ) : (
                  <Icon size={12} />
                )}
                {label.toUpperCase()}
                {status === 'done' && (
                  isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                )}
              </button>
            );
          })}
        </div>

        {/* Expanded saved phase values */}
        {expandedPhase && perceptionsDone.includes(expandedPhase) && (() => {
          const savedVals = getPhasePerceptionValues(expandedPhase);
          if (!savedVals) return null;
          return (
            <div className="rounded-xl bg-muted/50 p-3 mb-4">
              <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-2">
                {phaseDescriptions[expandedPhase]} — Registrado
              </p>
              <div className="grid grid-cols-2 gap-2">
                {sliders.map((s) => (
                  <div key={s.key} className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{s.label}</span>
                    <span className="text-xs font-mono font-bold text-foreground">{savedVals[s.key]}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* All phases done */}
        {allPhasesDone && (
          <div className="text-center py-4 mb-2">
            <p className="text-sm text-foreground font-medium">Todas as fases registradas</p>
            <p className="text-xs text-muted-foreground mt-1">Média do dia calculada e aplicada ao VYR State</p>
          </div>
        )}

        {/* Locked phase message */}
        {selectedPhase === null && !allPhasesDone && (
          <div className="text-center py-4 mb-2">
            <Lock size={16} className="text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Aguardando horário da próxima fase</p>
          </div>
        )}

        {/* Sliders for active selected phase */}
        {selectedPhase && !perceptionsDone.includes(selectedPhase) && (
          <>
            <p className="text-xs text-muted-foreground mb-4">{phaseDescriptions[selectedPhase]}</p>
            <div className="space-y-5">
              {sliders.map((s) => (
                <div key={s.key}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-bold text-foreground">{s.label}</span>
                    <span className="text-sm font-mono font-bold text-foreground">{values[s.key]}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{s.desc}</p>
                  <input type="range" min={0} max={10} value={values[s.key]}
                    onChange={(e) => handleChange(s.key, Number(e.target.value))}
                    className="w-full accent-primary h-1" />
                  <div className="flex justify-between mt-1">
                    <span className="text-[10px] text-muted-foreground">Baixo</span>
                    <span className="text-[10px] text-muted-foreground">Médio</span>
                    <span className="text-[10px] text-muted-foreground">Alto</span>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={handleSubmit} disabled={saving}
              className="w-full rounded-xl bg-primary text-primary-foreground font-medium py-3.5 text-sm transition-all active:scale-[0.98] hover:opacity-90 mt-6 disabled:opacity-50">
              {saving ? 'Salvando...' : `Registrar ${selectedPhase}`}
            </button>
          </>
        )}
      </div>

      {/* History — only after CLEAR done */}
      {clearDone && history.length > 0 && (
        <div className="rounded-2xl bg-card border border-border p-4">
          <h3 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium mb-3">
            Histórico de percepções
          </h3>
          <p className="text-[10px] text-muted-foreground mb-3">F=Foco, C=Clareza, E=Energia, Es=Estabilidade</p>
          <div className="space-y-3">
            {history.map((r) => {
              const vals = [r.focus_score, r.clarity_score, r.energy_score, r.mood_score].filter((v): v is number => v != null);
              const mean = vals.length > 0 ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '—';
              return (
                <div key={r.day} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <span className="text-xs text-muted-foreground">
                    {new Date(r.day + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                  </span>
                  <div className="flex items-center gap-2 text-xs text-secondary-foreground">
                    <span>F:{r.focus_score ?? '—'}</span>
                    <span>C:{r.clarity_score ?? '—'}</span>
                    <span>E:{r.energy_score ?? '—'}</span>
                    <span>Es:{r.mood_score ?? '—'}</span>
                  </div>
                  <span className="text-sm font-bold text-primary">{mean}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Observações Livres */}
      {checkpoints.length > 0 && (
        <div className="rounded-2xl bg-card border border-border p-4">
          <h3 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium mb-3">
            Observações livres
          </h3>
          <div className="space-y-3">
            {checkpoints.map((cp) => (
              <div key={cp.id} className="flex items-start gap-2">
                <Clock size={14} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                <div>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(cp.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <p className="text-sm text-secondary-foreground">{(cp.data as any)?.note || 'Sem nota'}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default PerceptionsTab;
