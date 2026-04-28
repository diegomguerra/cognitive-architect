import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { useVYRStore } from '@/hooks/useVYRStore';
import { recomputeStateWithPerceptions } from '@/lib/vyr-recompute';
import { toast } from 'sonner';

interface SachetConfirmationProps {
  phase: string;
  onDismiss: () => void;
  onAddObservation: () => void;
}

const phaseConfig: Record<string, { next: string; colorVar: string }> = {
  BOOT: { next: '2–3h', colorVar: '--vyr-accent-action' },
  HOLD: { next: '3–4h', colorVar: '--vyr-accent-transition' },
  CLEAR: { next: 'amanhã', colorVar: '--vyr-accent-stable' },
};

const sliders = [
  { key: 'foco', label: 'FOCO' },
  { key: 'clareza', label: 'CLAREZA' },
  { key: 'energia', label: 'ENERGIA' },
  { key: 'estabilidade', label: 'ESTABILIDADE' },
];

const SachetConfirmation = ({ phase, onDismiss }: SachetConfirmationProps) => {
  const config = phaseConfig[phase] || phaseConfig.BOOT;
  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  const { logPerception, perceptionsDone } = useVYRStore();
  const alreadyDone = perceptionsDone.includes(phase);

  const [showSliders, setShowSliders] = useState(false);
  const [values, setValues] = useState<Record<string, number>>(
    Object.fromEntries(sliders.map((s) => [s.key, 5]))
  );
  const [saving, setSaving] = useState(false);

  const handleSavePerception = async () => {
    setSaving(true);
    try {
      await logPerception(phase, values);
      try {
        await recomputeStateWithPerceptions({
          energy: values.energia,
          clarity: values.clareza,
          focus: values.foco,
          stability: values.estabilidade,
        });
      } catch {}
      toast.success(`${phase} percepção registrada`);
      onDismiss();
    } catch {
      toast.error('Erro ao salvar percepção');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onDismiss}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-[calc(100%-2rem)] max-w-md rounded-2xl bg-card p-5 space-y-3 max-h-[85dvh] overflow-y-auto"
        style={{ animation: 'slide-up 300ms ease-out' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button onClick={onDismiss} className="absolute top-3 right-3 text-muted-foreground hover:text-foreground z-10">
          <X size={20} />
        </button>

        {/* Header */}
        <div className="flex flex-col items-center gap-2 pt-1">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center"
            style={{ background: `hsl(var(${config.colorVar}) / 0.2)` }}
          >
            <Check size={24} style={{ color: `hsl(var(${config.colorVar}))` }} />
          </div>
          <h3 className="text-base font-semibold text-foreground">{phase} ativado</h3>
        </div>

        {/* Info */}
        <div className="space-y-1 text-center">
          <p className="text-xs text-muted-foreground">
            Registrado às <span className="font-mono font-medium text-foreground">{timeStr}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Próxima leitura em <span className="font-medium text-foreground">{config.next}</span>
          </p>
        </div>

        {/* Perception Sliders (inline) */}
        {showSliders && !alreadyDone && (
          <div className="space-y-4 pt-2">
            <p className="text-xs text-muted-foreground text-center">Como você está se sentindo agora?</p>
            {sliders.map((s) => (
              <div key={s.key}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-foreground">{s.label}</span>
                  <span className="text-xs font-mono font-bold text-foreground">{values[s.key]}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={10}
                  value={values[s.key]}
                  onChange={(e) => setValues((prev) => ({ ...prev, [s.key]: Number(e.target.value) }))}
                  className="w-full accent-primary h-1"
                />
                <div className="flex justify-between mt-0.5">
                  <span className="text-[9px] text-muted-foreground">Baixo</span>
                  <span className="text-[9px] text-muted-foreground">Alto</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          {!showSliders && !alreadyDone ? (
            <>
              <button
                onClick={() => setShowSliders(true)}
                className="flex-1 rounded-xl border border-border py-3 text-sm font-medium text-foreground transition-all active:scale-[0.98]"
              >
                Registrar percepções
              </button>
              <button
                onClick={onDismiss}
                className="flex-1 rounded-xl py-3 text-sm font-medium text-foreground transition-all active:scale-[0.98]"
                style={{
                  background: `hsl(var(${config.colorVar}))`,
                  boxShadow: `0 4px 12px -4px hsl(var(${config.colorVar}) / 0.4)`,
                }}
              >
                Continuar
              </button>
            </>
          ) : showSliders && !alreadyDone ? (
            <button
              onClick={handleSavePerception}
              disabled={saving}
              className="w-full rounded-xl py-3 text-sm font-medium text-foreground transition-all active:scale-[0.98] disabled:opacity-50"
              style={{
                background: `hsl(var(${config.colorVar}))`,
                boxShadow: `0 4px 12px -4px hsl(var(${config.colorVar}) / 0.4)`,
              }}
            >
              {saving ? 'Salvando...' : `Registrar ${phase}`}
            </button>
          ) : (
            <button
              onClick={onDismiss}
              className="w-full rounded-xl py-3 text-sm font-medium text-foreground transition-all active:scale-[0.98]"
              style={{
                background: `hsl(var(${config.colorVar}))`,
                boxShadow: `0 4px 12px -4px hsl(var(${config.colorVar}) / 0.4)`,
              }}
            >
              Continuar
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default SachetConfirmation;
