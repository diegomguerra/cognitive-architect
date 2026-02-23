import { User, Bell, Link, LogOut, ChevronRight } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import BrainLogo from '@/components/BrainLogo';

const menuItems = [
  { icon: User, label: 'Perfil', path: '/profile' },
  { icon: Bell, label: 'Notificações', path: '/notifications' },
  { icon: Link, label: 'Integrações', path: '/integrations' },
];

const SettingsPage = () => {
  return (
    <div className="min-h-dvh bg-background pb-24 safe-area-top">
      <header className="px-5 pt-6 pb-4">
        <h1 className="text-lg font-semibold text-foreground">Configurações</h1>
      </header>

      {/* User card */}
      <div className="mx-5 rounded-2xl bg-card p-4 flex items-center gap-3 mb-6">
        <BrainLogo size={40} />
        <div>
          <p className="text-sm font-medium text-foreground">Usuário VYR</p>
          <p className="text-xs text-vyr-text-secondary">usuario@email.com</p>
        </div>
      </div>

      <div className="px-5 space-y-1">
        {menuItems.map(({ icon: Icon, label }) => (
          <button
            key={label}
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-colors active:bg-accent"
          >
            <Icon size={20} className="text-vyr-text-secondary" strokeWidth={1.8} />
            <span className="text-sm text-foreground flex-1 text-left">{label}</span>
            <ChevronRight size={16} className="text-vyr-text-muted" />
          </button>
        ))}

        <div className="h-px bg-border my-2" />

        <button className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-colors active:bg-accent">
          <LogOut size={20} className="text-vyr-caution" strokeWidth={1.8} />
          <span className="text-sm text-vyr-caution">Sair</span>
        </button>
      </div>

      {/* Version */}
      <p className="text-center text-[10px] font-mono text-vyr-text-muted mt-8">
        VYR Labs v1.0.0 · Build 001
      </p>

      <BottomNav />
    </div>
  );
};

export default SettingsPage;
