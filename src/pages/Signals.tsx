import { ArrowLeft, Heart, Moon, Activity, Wind } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '@/components/BottomNav';

const signals = [
  { icon: Heart, label: 'FC Repouso', value: '58 bpm', status: 'normal' },
  { icon: Activity, label: 'HRV (SDNN)', value: '45 ms', status: 'normal' },
  { icon: Moon, label: 'Sono', value: '7.2h', status: 'normal' },
  { icon: Wind, label: 'SpO2', value: '97%', status: 'normal' },
];

const Signals = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh bg-background pb-24 safe-area-top">
      <header className="flex items-center gap-3 px-5 py-4">
        <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={20} />
        </button>
        <h1 className="font-mono font-bold text-foreground text-sm">Sinais Biométricos</h1>
      </header>

      <div className="px-5 mt-4 space-y-3">
        {signals.map((s, i) => (
          <div key={i} className="rounded-2xl bg-card border border-border p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <s.icon size={20} className="text-primary" />
              <span className="text-sm font-medium text-foreground">{s.label}</span>
            </div>
            <span className="text-sm font-mono text-foreground">{s.value}</span>
          </div>
        ))}
      </div>

      <BottomNav />
    </div>
  );
};

export default Signals;
