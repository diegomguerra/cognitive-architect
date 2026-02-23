import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '@/components/BottomNav';

const sliders = [
  { key: 'foco', label: 'Foco' },
  { key: 'energia_percebida', label: 'Energia percebida' },
  { key: 'humor', label: 'Humor' },
  { key: 'ansiedade', label: 'Ansiedade' },
  { key: 'qualidade_sono', label: 'Qualidade do sono' },
];

const Perceptions = () => {
  const navigate = useNavigate();
  const [values, setValues] = useState<Record<string, number>>(
    Object.fromEntries(sliders.map((s) => [s.key, 5]))
  );

  const handleChange = (key: string, val: number) => {
    setValues((prev) => ({ ...prev, [key]: val }));
  };

  return (
    <div className="min-h-dvh bg-background pb-24 safe-area-top">
      <header className="flex items-center gap-3 px-5 py-4">
        <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={20} />
        </button>
        <h1 className="font-mono font-bold text-foreground text-sm">Percepções</h1>
      </header>

      <div className="px-5 mt-4 space-y-6">
        <p className="text-sm text-muted-foreground">Como você se sente agora? (0 = péssimo, 10 = excelente)</p>
        {sliders.map((s) => (
          <div key={s.key} className="space-y-2">
            <div className="flex justify-between">
              <label className="text-sm font-medium text-foreground">{s.label}</label>
              <span className="text-sm font-mono text-primary">{values[s.key]}</span>
            </div>
            <input
              type="range"
              min={0}
              max={10}
              value={values[s.key]}
              onChange={(e) => handleChange(s.key, Number(e.target.value))}
              className="w-full accent-primary"
            />
          </div>
        ))}

        <button className="w-full rounded-xl bg-primary text-primary-foreground font-medium py-3.5 text-sm transition-all active:scale-[0.98] hover:opacity-90 mt-4">
          Salvar percepções
        </button>
      </div>

      <BottomNav />
    </div>
  );
};

export default Perceptions;
