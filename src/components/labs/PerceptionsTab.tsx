import { useState } from 'react';
import { Info, Zap, Eye, Moon, X } from 'lucide-react';

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
  { key: 'foco', label: 'FOCO', desc: 'Como está sua capacidade de concentração?' },
  { key: 'clareza', label: 'CLAREZA', desc: 'Sua mente está clara ou confusa?' },
  { key: 'energia', label: 'ENERGIA', desc: 'Qual seu nível de energia física?' },
  { key: 'estabilidade', label: 'ESTABILIDADE', desc: 'Como está sua estabilidade emocional?' },
];

const PerceptionsTab = () => {
  const [showInfo, setShowInfo] = useState(true);
  const [mode, setMode] = useState<'geral' | 'fase'>('geral');
  const [selectedPhase, setSelectedPhase] = useState<'BOOT' | 'HOLD' | 'CLEAR'>('BOOT');
  const [values, setValues] = useState<Record<string, number>>(
    Object.fromEntries(sliders.map((s) => [s.key, 5]))
  );

  const handleChange = (key: string, val: number) => {
    setValues((prev) => ({ ...prev, [key]: val }));
  };

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

        {/* Geral / Por fase toggle */}
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
              {phases.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setSelectedPhase(key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    selectedPhase === key
                      ? 'bg-foreground text-background'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {label.toUpperCase()}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mb-4">{phaseDescriptions[selectedPhase]}</p>
          </>
        )}

        {/* Sliders */}
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

        {/* Submit */}
        <button className="w-full rounded-xl bg-primary text-primary-foreground font-medium py-3.5 text-sm transition-all active:scale-[0.98] hover:opacity-90 mt-6">
          {mode === 'fase' ? `Registrar ${selectedPhase.charAt(0) + selectedPhase.slice(1).toLowerCase()}` : 'Registrar percepção geral'}
        </button>
      </div>
    </div>
  );
};

export default PerceptionsTab;
