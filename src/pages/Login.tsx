import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import BrainLogo from '@/components/BrainLogo';

const Login = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Auth with Supabase
    navigate('/');
  };

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-5 bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <BrainLogo size={48} />
        <div>
          <h1 className="font-mono font-bold tracking-wide text-foreground text-lg">VYR App</h1>
          <p className="font-mono text-xs text-vyr-text-secondary">Performance cognitiva</p>
        </div>
        <span className="ml-3 border border-border rounded px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] text-vyr-text-muted font-mono">
          secure
        </span>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm rounded-2xl bg-card border border-border p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-foreground mb-1">Entrar</h2>
        <p className="text-sm text-vyr-text-secondary mb-6">Acesse sua conta</p>

        {/* OAuth */}
        <div className="space-y-3 mb-5">
          <button className="w-full flex items-center justify-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-xs text-vyr-text-secondary transition-transform active:scale-[0.98]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#8899AA"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#8899AA"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#8899AA"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#8899AA"/></svg>
            Continuar com Google
          </button>
          <button className="w-full flex items-center justify-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-xs text-vyr-text-secondary transition-transform active:scale-[0.98]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#A7ADB8"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>
            Continuar com Apple
          </button>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-5">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-vyr-text-muted uppercase">ou</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-vyr-text-secondary/40 outline-none focus:ring-1 focus:ring-ring transition-colors"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-foreground">Senha</label>
              <button type="button" className="text-xs text-vyr-accent-action hover:underline">
                Esqueci minha senha
              </button>
            </div>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-vyr-text-secondary/40 outline-none focus:ring-1 focus:ring-ring transition-colors pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-vyr-text-muted"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <button
            type="submit"
            className="w-full rounded-xl bg-vyr-text-primary text-vyr-bg-primary font-medium py-3.5 text-sm transition-all active:scale-[0.98] hover:opacity-90 mt-2"
          >
            Entrar
          </button>
        </form>

        <p className="text-center text-sm text-vyr-text-secondary mt-5">
          Não tem conta?{' '}
          <button className="text-vyr-accent-action hover:underline">Criar</button>
        </p>
      </div>

      {/* Footer */}
      <p className="font-mono text-[10px] text-vyr-text-secondary/50 mt-8 text-center">
        Clareza mental é construída com consistência
      </p>
    </div>
  );
};

export default Login;
