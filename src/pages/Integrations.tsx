import { ArrowLeft, Heart, Activity, Info } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '@/components/BottomNav';

const IntegrationsPage = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh bg-background pb-24 safe-area-top">
      <header className="px-5 pt-6 pb-2">
        <h1 className="text-lg font-semibold text-foreground">Integrações</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Conecte seus dispositivos para alimentar o motor cognitivo.
        </p>
      </header>

      <div className="px-5 mt-4 space-y-4">
        {/* Apple Health */}
        <div className="rounded-2xl bg-card border border-border p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500 to-red-500 flex items-center justify-center">
              <Heart size={20} className="text-white" fill="white" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Apple Health</h3>
              <p className="text-xs text-muted-foreground">Não conectado</p>
            </div>
          </div>
          <button className="w-full rounded-xl bg-primary text-primary-foreground font-medium py-3 text-sm transition-all active:scale-[0.98] hover:opacity-90">
            Conectar Apple Health
          </button>
        </div>

        {/* J-Style Ring */}
        <div className="rounded-2xl bg-card border border-border p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
              <Activity size={20} className="text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">J-Style Ring</h3>
              <p className="text-xs text-muted-foreground">Não conectado</p>
            </div>
          </div>
          <button className="w-full rounded-xl bg-muted text-foreground font-medium py-3 text-sm transition-all active:scale-[0.98] hover:opacity-90">
            Conectar J-Style Ring
          </button>
        </div>

        {/* Others */}
        <div className="rounded-2xl bg-card border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
              <Info size={20} className="text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Outros wearables</h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Garmin, Whoop, Oura, Fitbit e demais dispositivos compatíveis serão integrados automaticamente via Apple Health.
              </p>
            </div>
          </div>
        </div>
      </div>

      <BottomNav />
    </div>
  );
};

export default IntegrationsPage;
