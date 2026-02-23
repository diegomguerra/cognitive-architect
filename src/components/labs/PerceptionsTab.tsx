import { useState } from 'react';
import { Info, Zap, Eye, Moon } from 'lucide-react';
import { requireValidUserId, retryOnAuthErrorLabeled } from '@/lib/auth-session';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const phases = [
  { key: 'BOOT', label: 'Boot', sub: '05h–11h', icon: Zap },
  { key: 'HOLD', label: 'Hold', sub: '11h–17h', icon: Eye },
  { key: 'CLEAR', label: 'Clear', sub: '17h–22h', icon: Moon },
] as const;

const phaseDescriptions: Record<string, string> = {
  BOOT: 'BOOT — Manhã · Ativação',
  HOLD: 'HOLD — Tarde · Sustentação',
  CLEAR: 'CLEAR — Noite · Recuperação',
};

const sliders = [
  { key: 'foco', label: 'FOCO', desc: 'Como está sua capacidade de concentração?', dbKey: 'focus_score' },
  { key: 'clareza', label: 'CLAREZA', desc: 'Sua mente está clara ou confusa?', dbKey: 'clarity_score' },
  { key: 'energia', label: 'ENERGIA', desc: 'Qual seu nível de energia física?', dbKey: 'energy_score' },
  { key: 'estabilidade', label: 'ESTABILIDADE', desc: 'Como está sua estabilidade emocional?', dbKey: 'mood_score' },
];

const PerceptionsTab = () => {
  const [showInfo, setShowInfo] = useState(true);
  const [mode, setMode] = useState<'geral' | 'fase'>('geral');
  const [selectedPhase, setSelectedPhase] = useState<'BOOT' | 'HOLD' | 'CLEAR'>('BOOT');
  const [saving, setSaving] = useState(false);
  const [savedPhases, setSavedPhases] = useState<string[]>([]);
  const [values, setValues] = useState<Record<string, number>>(
    Object.fromEntries(sliders.map((s) => [s.key, 5]))
  );

  const handleChange = (key: string, val: number) => {
    setValues((prev) => ({ ...prev, [key]: val }));
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const userId = await requireValidUserId();
      const today = new Date().toISOString().split('T')[0];

      // Save to daily_reviews
      await retryOnAuthErrorLabeled(async () => {
        const result = await supabase.from('daily_reviews').upsert({
          user_id: userId,
          day: today,
          focus_score: values.foco,
          clarity_score: values.clareza,
          energy_score: values.energia,
          mood_score: values.estabilidade,
        }, { onConflict: 'user_id,day' }).select();
        return result;
      });

      // Log action
      await retryOnAuthErrorLabeled(async () => {
        const result = await supabase.from('action_logs').insert({
          user_id: userId,
          day: today,
          action_type: mode === 'fase' ? `perception_${selectedPhase}` : 'perception_general',
          payload: { values, mode, phase: mode === 'fase' ? selectedPhase : null },
        }).select();
        return result;
      });

      if (mode === 'fase') {
        setSavedPhases((prev) => [...prev, selectedPhase]);
        // Auto-advance
        const nextPhase = phases.find((p) => !savedPhases.includes(p.key) && p.key !== selectedPhase);
        if (nextPhase) setSelectedPhase(nextPhase.key as any);
      }

      toast.success(mode === 'fase' ? `${selectedPhase} registrado` : 'Percepção geral registrada');
    } catch (err) {
      console.error('[perceptions] Save failed:', err);
      toast.error('Erro ao salvar percepção');
    } finally {
      setSaving(false);
    }
  };

  const allPhasesSaved = phases.every((p) => savedPhases.includes(p.key));

  return (
    <div className="space-y-4">
      {/* Como funciona */}
      {showInfo && (
        <div className="rounded-2xl bg-card border border-border p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              <Info size={16} className="text-muted-foreground" />
              <span className="text-sm font-semibold text-foreground">Como funciona</span>
            </div>
            <button onClick={() => setShowInfo(false)} className="text-xs text-muted-foreground hover:text-foreground">
              Fechar
            </button>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            O algoritmo VYR combina <span className="text-foreground font-medium">dados biométricos</span> do seu wearable com suas{' '}
            <span className="text-foreground font-medium">percepções subjetivas</span> para calcular seu estado cognitivo real.
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
          <p className="text-xs text-muted-foreground text-center leading-relaxed">
            Registre sua percepção em cada fase do dia. Quanto mais registros, mais o sistema aprende seu padrão e melhora as recomendações.
          </p>
        </div>
      )}

      {/* Performance Cognitiva */}
      <div className="rounded-2xl bg-card border border-border p-4">
        <h3 className="text-xs uppercase tracking-[0.15em] font-semibold text-foreground mb-3">
          Performance Cognitiva
        </h3>

        {/* Mode toggle */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setMode('geral')}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              mode === 'geral' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}
          >
            Geral do dia
          </button>
          <button
            onClick={() => setMode('fase')}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              mode === 'fase' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}
          >
            Por fase
          </button>
        </div>

        {/* Phase selector */}
        {mode === 'fase' && (
          <>
            <div className="flex gap-2 mb-2">
              {phases.map(({ key, label }) => {
                const isSaved = savedPhases.includes(key);
                return (
                  <button
                    key={key}
                    onClick={() => !isSaved && setSelectedPhase(key as any)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      selectedPhase === key && !isSaved
                        ? 'bg-foreground text-background'
                        : isSaved
                        ? 'bg-muted text-muted-foreground line-through opacity-60'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {isSaved ? `✓ ${label.toUpperCase()}` : label.toUpperCase()}
                  </button>
                );
              })}
            </div>
            {!allPhasesSaved && (
              <p className="text-xs text-muted-foreground mb-4">{phaseDescriptions[selectedPhase]}</p>
            )}
            {allPhasesSaved && (
              <div className="text-center py-4 mb-4">
                <p className="text-sm text-foreground font-medium">Todas as fases registradas ✓</p>
                <button
                  onClick={() => setSavedPhases([])}
                  className="text-xs text-primary mt-1"
                >
                  Refazer registros
                </button>
              </div>
            )}
          </>
        )}

        {/* Sliders */}
        {!(mode === 'fase' && allPhasesSaved) && (
          <>
            <div className="space-y-5">
              {sliders.map((s) => (
                <div key={s.key}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-bold text-foreground">{s.label}</span>
                    <span className="text-sm font-mono font-bold text-foreground">{values[s.key]}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{s.desc}</p>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    value={values[s.key]}
                    onChange={(e) => handleChange(s.key, Number(e.target.value))}
                    className="w-full accent-primary h-1"
                  />
                  <div className="flex justify-between mt-1">
                    <span className="text-[10px] text-muted-foreground">Baixo</span>
                    <span className="text-[10px] text-muted-foreground">Médio</span>
                    <span className="text-[10px] text-muted-foreground">Alto</span>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={handleSubmit}
              disabled={saving}
              className="w-full rounded-xl bg-primary text-primary-foreground font-medium py-3.5 text-sm transition-all active:scale-[0.98] hover:opacity-90 mt-6 disabled:opacity-50"
            >
              {saving ? 'Salvando...' :
                mode === 'fase' ? `Registrar ${selectedPhase.charAt(0) + selectedPhase.slice(1).toLowerCase()}` : 'Registrar percepção geral'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default PerceptionsTab;
