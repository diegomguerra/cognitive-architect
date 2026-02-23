import { useState, useEffect } from 'react';
import { User, Bell, Link, LogOut, ChevronRight, Shield } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '@/components/BottomNav';
import BrainLogo from '@/components/BrainLogo';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

const SettingsPage = () => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [userName, setUserName] = useState('Usuário VYR');
  const [baselineDays, setBaselineDays] = useState(0);

  useEffect(() => {
    if (!user?.id) return;

    // Load name and baseline progress
    Promise.all([
      supabase.from('participantes').select('nome_publico').eq('user_id', user.id).maybeSingle(),
      supabase.from('ring_daily_data').select('day', { count: 'exact', head: true }).eq('user_id', user.id),
    ]).then(([nameRes, baselineRes]) => {
      if (nameRes.data?.nome_publico) setUserName(nameRes.data.nome_publico);
      if (baselineRes.count) setBaselineDays(Math.min(baselineRes.count, 7));
    });
  }, [user?.id]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const menuItems = [
    { icon: User, label: 'Meu Perfil', desc: 'Editar dados e foto', path: '/profile' },
    { icon: Bell, label: 'Notificações', desc: 'Gerenciar alertas', path: '/notifications' },
    { icon: Link, label: 'Integrações', desc: 'Wearables e dispositivos', path: '/integrations' },
  ];

  return (
    <div className="min-h-dvh bg-background pb-24 safe-area-top">
      <header className="px-5 pt-6 pb-4">
        <h1 className="text-lg font-semibold text-foreground">Configurações</h1>
      </header>

      {/* User card */}
      <div className="mx-5 rounded-2xl bg-card border border-border p-4 flex items-center gap-3 mb-6">
        <BrainLogo size={40} />
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">{userName}</p>
          <p className="text-xs text-muted-foreground">{user?.email || 'usuario@email.com'}</p>
        </div>
      </div>

      <div className="px-5 space-y-1">
        {menuItems.map(({ icon: Icon, label, desc, path }) => (
          <button
            key={label}
            onClick={() => navigate(path)}
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-colors active:bg-accent"
          >
            <Icon size={20} className="text-muted-foreground" strokeWidth={1.8} />
            <div className="flex-1 text-left">
              <span className="text-sm text-foreground">{label}</span>
              <p className="text-[10px] text-muted-foreground">{desc}</p>
            </div>
            <ChevronRight size={16} className="text-muted-foreground" />
          </button>
        ))}

        {/* Baseline progress */}
        <div className="px-4 py-3.5">
          <div className="flex items-center gap-3 mb-2">
            <Shield size={20} className="text-muted-foreground" strokeWidth={1.8} />
            <div className="flex-1">
              <span className="text-sm text-foreground">Baseline pessoal</span>
              <p className="text-[10px] text-muted-foreground">{baselineDays}/7 dias registrados</p>
            </div>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden ml-8">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${(baselineDays / 7) * 100}%`,
                background: 'hsl(var(--vyr-accent-action))',
              }}
            />
          </div>
        </div>

        <div className="h-px bg-border my-2" />

        {/* Privacy */}
        <div className="px-4 py-3">
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Seus dados biométricos são processados internamente e nunca compartilhados com terceiros. O algoritmo VYR opera exclusivamente no seu dispositivo e na sua conta segura.
          </p>
        </div>

        <div className="h-px bg-border my-2" />

        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-colors active:bg-accent"
        >
          <LogOut size={20} className="text-destructive" strokeWidth={1.8} />
          <span className="text-sm text-destructive">Sair</span>
        </button>
      </div>

      {/* Version */}
      <p className="text-center text-[10px] font-mono text-muted-foreground mt-8 opacity-40">
        VYR Labs v1.0.0 · Build 001
      </p>

      <BottomNav />
    </div>
  );
};

export default SettingsPage;
