import { ArrowLeft, Smartphone } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '@/components/BottomNav';
import ConnectionStatus from '@/components/ConnectionStatus';

const IntegrationsPage = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh bg-background pb-24 safe-area-top">
      <header className="flex items-center gap-3 px-5 py-4">
        <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={20} />
        </button>
        <h1 className="font-mono font-bold text-foreground text-sm">Integrações</h1>
      </header>

      <div className="px-5 mt-4 space-y-4">
        <div className="rounded-2xl bg-card border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Smartphone size={20} className="text-primary" />
              <div>
                <h3 className="text-sm font-medium text-foreground">Apple Health</h3>
                <p className="text-xs text-muted-foreground">HealthKit</p>
              </div>
            </div>
            <ConnectionStatus status="disconnected" />
          </div>
          <button className="w-full rounded-xl bg-primary text-primary-foreground font-medium py-3 text-sm transition-all active:scale-[0.98] hover:opacity-90">
            Conectar Apple Health
          </button>
        </div>
      </div>

      <BottomNav />
    </div>
  );
};

export default IntegrationsPage;
