import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Play } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import { getCurrentPhase } from '@/lib/vyr-engine';

const phaseConfig = {
  BOOT: { label: 'BOOT', time: '05h–11h', color: '--vyr-accent-action', description: 'Fase de ativação. Ideal para tarefas de alta demanda cognitiva e decisões estratégicas.' },
  HOLD: { label: 'HOLD', time: '11h–17h', color: '--vyr-accent-transition', description: 'Fase de sustentação. Mantenha o ritmo com blocos de foco intercalados por pausas.' },
  CLEAR: { label: 'CLEAR', time: '17h–22h+', color: '--vyr-accent-stable', description: 'Fase de descompressão. Reduza estímulos e prepare o sistema para recuperação.' },
};

const MomentAction = () => {
  const navigate = useNavigate();
  const phase = useMemo(() => getCurrentPhase(), []);
  const config = phaseConfig[phase];

  const actions = phase === 'BOOT'
    ? ['Iniciar bloco de foco (25 min)', 'Revisar prioridades do dia', 'Hidratação + luz natural']
    : phase === 'HOLD'
    ? ['Bloco de foco curto (15 min)', 'Pausa ativa (caminhada)', 'Revisar progresso']
    : ['Registrar percepções do dia', 'Desligar notificações', 'Preparar rotina de sono'];

  return (
    <div className="min-h-dvh bg-background pb-24 safe-area-top">
      <header className="flex items-center gap-3 px-5 py-4">
        <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={20} />
        </button>
        <h1 className="font-mono font-bold text-foreground text-sm">Protocolo {config.label}</h1>
      </header>

      <div className="px-5 mt-4 space-y-4">
        <div
          className="rounded-2xl p-6 text-center"
          style={{
            background: `hsl(var(${config.color}) / 0.15)`,
            border: `1px solid hsl(var(${config.color}) / 0.3)`,
          }}
        >
          <span
            className="text-4xl font-mono font-bold"
            style={{ color: `hsl(var(${config.color}))` }}
          >
            {config.label}
          </span>
          <p className="text-xs text-muted-foreground mt-1">{config.time}</p>
        </div>

        <p className="text-sm text-secondary-foreground">{config.description}</p>

        <h3 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">Ações sugeridas</h3>

        <div className="space-y-3">
          {actions.map((action, i) => (
            <button
              key={i}
              className="w-full flex items-center gap-3 rounded-xl bg-card border border-border p-4 text-left text-sm text-foreground transition-transform active:scale-[0.98]"
            >
              <Play size={14} style={{ color: `hsl(var(${config.color}))` }} />
              {action}
            </button>
          ))}
        </div>
      </div>

      <BottomNav />
    </div>
  );
};

export default MomentAction;
