import { useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Play } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import { getCurrentPhase } from '@/lib/vyr-engine';
import { requireValidUserId, retryOnAuthErrorLabeled } from '@/lib/auth-session';
import { supabase } from '@/integrations/supabase/client';

const phaseConfig = {
  BOOT: {
    label: 'BOOT', time: '05h–11h', colorVar: '--vyr-accent-action',
    title: 'Início de ciclo',
    systemText: 'Fase de ativação cognitiva gradual.',
    whatHappens: 'O sistema irá iniciar ativação cognitiva gradual. Os compostos do sachet BOOT são formulados para melhorar a disponibilidade de energia mental e clareza durante as primeiras horas do dia.',
    whatExpect: 'Você deve esperar uma sensação de clareza progressiva nas próximas 2-3 horas. Ideal para tarefas de alta demanda cognitiva e decisões estratégicas.',
    gradient: 'from-[hsl(var(--vyr-accent-action)/0.2)]',
  },
  HOLD: {
    label: 'HOLD', time: '11h–17h', colorVar: '--vyr-accent-transition',
    title: 'Sustentação',
    systemText: 'Fase de manutenção do rendimento cognitivo.',
    whatHappens: 'O sistema irá priorizar estabilidade cognitiva. O sachet HOLD mantém os níveis de neurotransmissores em faixa funcional, prevenindo quedas abruptas de rendimento.',
    whatExpect: 'Você deve esperar uma sensação de constância mental. Blocos de foco intercalados com pausas curtas maximizarão o rendimento.',
    gradient: 'from-[hsl(var(--vyr-accent-transition)/0.2)]',
  },
  CLEAR: {
    label: 'CLEAR', time: '17h–22h+', colorVar: '--vyr-accent-stable',
    title: 'Encerramento',
    systemText: 'Fase de recuperação e descompressão.',
    whatHappens: 'O sistema irá facilitar a transição para um estado de recuperação. O sachet CLEAR contém compostos que promovem relaxamento gradual sem sedação excessiva.',
    whatExpect: 'Você deve esperar uma sensação de desaceleração suave. Reduza estímulos e prepare a rotina de sono.',
    gradient: 'from-[hsl(var(--vyr-accent-stable)/0.2)]',
  },
};

const MomentAction = () => {
  const navigate = useNavigate();
  const phase = useMemo(() => getCurrentPhase(), []);
  const config = phaseConfig[phase];

  const handleConfirm = useCallback(async () => {
    try {
      const userId = await requireValidUserId();
      const today = new Date().toISOString().split('T')[0];

      await retryOnAuthErrorLabeled(async () => {
        const result = await supabase.from('action_logs').insert({
          user_id: userId,
          day: today,
          action_type: phase,
          payload: { confirmed_at: new Date().toISOString(), source: 'moment_action' },
        }).select();
        return result;
      });

      navigate('/');
    } catch (err) {
      console.error('[moment-action] Failed:', err);
    }
  }, [phase, navigate]);

  return (
    <div className="min-h-dvh bg-background pb-32 safe-area-top">
      {/* Header with gradient */}
      <div
        className="relative px-5 pt-4 pb-8"
        style={{ background: `linear-gradient(to bottom, hsl(var(${config.colorVar}) / 0.2), transparent)` }}
      >
        <header className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft size={20} />
          </button>
          <h1 className="font-mono font-bold text-foreground text-sm">Protocolo {config.label}</h1>
        </header>

        <div className="flex flex-col items-center mt-8">
          <div className="w-16 h-16 rounded-full bg-card flex items-center justify-center">
            <Play size={28} fill="currentColor" style={{ color: `hsl(var(${config.colorVar}))` }} />
          </div>
          <h2 className="text-lg font-semibold text-foreground mt-3">{config.title}</h2>
          <p className="text-xs text-muted-foreground mt-1">{config.systemText}</p>
        </div>
      </div>

      {/* Info card */}
      <div className="px-5 mt-4">
        <div className="rounded-2xl bg-card border border-border p-5 space-y-4">
          <div>
            <h3 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium mb-2">
              O que vai acontecer
            </h3>
            <p className="text-sm text-secondary-foreground leading-relaxed">{config.whatHappens}</p>
          </div>
          <div className="h-px bg-border" />
          <div>
            <h3 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium mb-2">
              O que esperar
            </h3>
            <p className="text-sm text-secondary-foreground leading-relaxed">{config.whatExpect}</p>
          </div>
        </div>
      </div>

      {/* Fixed bottom action */}
      <div className="fixed bottom-0 left-0 right-0 p-5 safe-area-bottom" style={{ background: 'linear-gradient(to top, hsl(var(--background)), transparent)' }}>
        <button
          onClick={handleConfirm}
          className="w-full rounded-xl py-4 flex items-center justify-center gap-2 text-sm font-medium text-foreground transition-transform active:scale-[0.98]"
          style={{
            background: `hsl(var(${config.colorVar}))`,
            boxShadow: `0 4px 20px -4px hsl(var(${config.colorVar}) / 0.4)`,
          }}
        >
          <Play size={16} fill="currentColor" />
          Confirmar {config.label}
        </button>
      </div>

      <BottomNav />
    </div>
  );
};

export default MomentAction;
