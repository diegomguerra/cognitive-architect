import { ArrowLeft, User, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import BottomNav from '@/components/BottomNav';

const Profile = () => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="min-h-dvh bg-background pb-24 safe-area-top">
      <header className="flex items-center gap-3 px-5 py-4">
        <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={20} />
        </button>
        <h1 className="font-mono font-bold text-foreground text-sm">Perfil</h1>
      </header>

      <div className="px-5 mt-4 space-y-4">
        <div className="rounded-2xl bg-card border border-border p-6 flex flex-col items-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-3">
            <User size={28} className="text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">{user?.email || 'Usuário'}</p>
          <p className="text-xs text-muted-foreground mt-1">Membro VYR</p>
        </div>

        <button
          onClick={handleSignOut}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-3.5 text-sm text-destructive transition-transform active:scale-[0.98]"
        >
          <LogOut size={16} />
          Sair da conta
        </button>
      </div>

      <BottomNav />
    </div>
  );
};

export default Profile;
