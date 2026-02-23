import { ArrowLeft, Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '@/components/BottomNav';

const demoNotifications = [
  { title: 'Hora do BOOT', body: 'Sua janela de foco matinal está aberta.', time: '08:00' },
  { title: 'Sync completo', body: 'Dados do Apple Health sincronizados.', time: '07:30' },
  { title: 'Revisão disponível', body: 'Complete sua revisão diária.', time: 'Ontem' },
];

const Notifications = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh bg-background pb-24 safe-area-top">
      <header className="flex items-center gap-3 px-5 py-4">
        <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={20} />
        </button>
        <h1 className="font-mono font-bold text-foreground text-sm">Notificações</h1>
      </header>

      <div className="px-5 mt-4 space-y-3">
        {demoNotifications.map((n, i) => (
          <div key={i} className="rounded-2xl bg-card border border-border p-4 flex items-start gap-3">
            <Bell size={16} className="text-primary mt-0.5" />
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-foreground">{n.title}</h3>
                <span className="text-[10px] text-muted-foreground">{n.time}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{n.body}</p>
            </div>
          </div>
        ))}
      </div>

      <BottomNav />
    </div>
  );
};

export default Notifications;
