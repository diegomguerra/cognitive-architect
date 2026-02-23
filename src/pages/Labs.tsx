import { FlaskConical, Brain, BarChart3, Zap } from 'lucide-react';
import BottomNav from '@/components/BottomNav';

const labItems = [
  { icon: Brain, title: 'Percepções', desc: 'Avalie seu estado subjetivo', badge: 'Ativo' },
  { icon: BarChart3, title: 'Histórico', desc: 'Evolução dos últimos 14 dias', badge: 'Em breve' },
  { icon: Zap, title: 'Sinais', desc: 'Biomarcadores detalhados', badge: 'Em breve' },
  { icon: FlaskConical, title: 'Revisões', desc: 'Revisão diária e checkpoints', badge: 'Em breve' },
];

const Labs = () => {
  return (
    <div className="min-h-dvh bg-background pb-24 safe-area-top">
      <header className="px-5 pt-6 pb-4">
        <h1 className="text-lg font-semibold text-foreground">Labs</h1>
        <p className="text-sm text-vyr-text-secondary mt-1">Ferramentas de análise cognitiva</p>
      </header>

      <div className="px-5 space-y-3">
        {labItems.map(({ icon: Icon, title, desc, badge }) => (
          <button
            key={title}
            className="w-full rounded-2xl bg-card p-4 flex items-center gap-4 text-left transition-transform active:scale-[0.98]"
          >
            <div className="w-10 h-10 rounded-xl bg-vyr-bg-elevated flex items-center justify-center flex-shrink-0">
              <Icon size={20} className="text-vyr-text-secondary" strokeWidth={1.8} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">{title}</span>
                <span className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ${badge === 'Ativo' ? 'text-vyr-positive bg-vyr-positive/10' : 'text-vyr-text-muted bg-vyr-bg-elevated'}`}>
                  {badge}
                </span>
              </div>
              <p className="text-xs text-vyr-text-secondary mt-0.5">{desc}</p>
            </div>
          </button>
        ))}
      </div>

      <BottomNav />
    </div>
  );
};

export default Labs;
