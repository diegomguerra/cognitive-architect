import { useState, useEffect } from 'react';
import { ArrowLeft, User, Save } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { requireValidUserId, retryOnAuthErrorLabeled } from '@/lib/auth-session';
import BottomNav from '@/components/BottomNav';
import { toast } from 'sonner';

const sexOptions = [
  { value: 'MASCULINO', label: 'Masculino' },
  { value: 'FEMININO', label: 'Feminino' },
  { value: 'OUTRO', label: 'Outro' },
  { value: 'NAO_INFORMAR', label: 'Prefiro não informar' },
] as const;

const Profile = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    nome_publico: '',
    data_nascimento: '',
    sexo: 'NAO_INFORMAR' as string,
    altura_cm: '' as string | number,
    peso_kg: '' as string | number,
    objetivo_principal: '',
  });

  useEffect(() => {
    if (!user?.id) return;
    supabase.from('participantes').select('*').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setForm({
            nome_publico: data.nome_publico || '',
            data_nascimento: data.data_nascimento || '',
            sexo: data.sexo || 'NAO_INFORMAR',
            altura_cm: data.altura_cm ?? '',
            peso_kg: data.peso_kg ?? '',
            objetivo_principal: data.objetivo_principal || '',
          });
        }
      });
  }, [user?.id]);

  const handleSave = async () => {
    setLoading(true);
    try {
      const userId = await requireValidUserId();
      const payload = {
        user_id: userId,
        nome_publico: form.nome_publico || 'Usuário VYR',
        data_nascimento: form.data_nascimento || '2000-01-01',
        sexo: form.sexo as any,
        altura_cm: form.altura_cm ? Number(form.altura_cm) : null,
        peso_kg: form.peso_kg ? Number(form.peso_kg) : null,
        objetivo_principal: form.objetivo_principal || null,
        codigo: `VYR-${userId.slice(0, 6).toUpperCase()}`,
      };

      await retryOnAuthErrorLabeled(async () => {
        const result = await supabase.from('participantes').upsert(payload, { onConflict: 'user_id' }).select();
        return result;
      });

      toast.success('Perfil salvo com sucesso');
    } catch (err) {
      console.error('[profile] Save failed:', err);
      toast.error('Erro ao salvar perfil');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-background pb-24 safe-area-top">
      <header className="flex items-center gap-3 px-5 py-4">
        <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={20} />
        </button>
        <h1 className="font-mono font-bold text-foreground text-sm">Meu Perfil</h1>
      </header>

      <div className="px-5 mt-2 space-y-5">
        {/* Avatar */}
        <div className="flex flex-col items-center">
          <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mb-2">
            <User size={32} className="text-muted-foreground" />
          </div>
          <p className="text-xs text-muted-foreground">{user?.email}</p>
        </div>

        {/* Form */}
        <div className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Nome público</label>
            <input
              value={form.nome_publico}
              onChange={(e) => setForm((f) => ({ ...f, nome_publico: e.target.value }))}
              className="w-full rounded-xl bg-card border border-border px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground"
              placeholder="Como quer ser chamado"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Data de nascimento</label>
            <input
              type="date"
              value={form.data_nascimento}
              onChange={(e) => setForm((f) => ({ ...f, data_nascimento: e.target.value }))}
              className="w-full rounded-xl bg-card border border-border px-4 py-3 text-sm text-foreground"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-2 block">Sexo</label>
            <div className="grid grid-cols-2 gap-2">
              {sexOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setForm((f) => ({ ...f, sexo: opt.value }))}
                  className={`rounded-xl border px-3 py-2.5 text-xs font-medium transition-colors ${
                    form.sexo === opt.value
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card border-border text-foreground'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Altura (cm)</label>
              <input
                type="number"
                value={form.altura_cm}
                onChange={(e) => setForm((f) => ({ ...f, altura_cm: e.target.value }))}
                className="w-full rounded-xl bg-card border border-border px-4 py-3 text-sm text-foreground"
                placeholder="175"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Peso (kg)</label>
              <input
                type="number"
                value={form.peso_kg}
                onChange={(e) => setForm((f) => ({ ...f, peso_kg: e.target.value }))}
                className="w-full rounded-xl bg-card border border-border px-4 py-3 text-sm text-foreground"
                placeholder="70"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Objetivo principal</label>
            <input
              value={form.objetivo_principal}
              onChange={(e) => setForm((f) => ({ ...f, objetivo_principal: e.target.value }))}
              className="w-full rounded-xl bg-card border border-border px-4 py-3 text-sm text-foreground"
              placeholder="Ex: melhorar foco no trabalho"
            />
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={loading}
          className="w-full rounded-xl bg-primary text-primary-foreground font-medium py-3.5 text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] hover:opacity-90 disabled:opacity-50"
        >
          <Save size={16} />
          {loading ? 'Salvando...' : 'Salvar alterações'}
        </button>
      </div>

      <BottomNav />
    </div>
  );
};

export default Profile;
