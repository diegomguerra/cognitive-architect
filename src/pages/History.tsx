import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '@/components/BottomNav';
import EvolutionChart from '@/components/EvolutionChart';

const History = () => {
  const navigate = useNavigate();

  // Demo data
  const data = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    return {
      date: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      score: Math.round(50 + Math.random() * 40),
      energia: +(1.5 + Math.random() * 3.5).toFixed(1),
      clareza: +(1.5 + Math.random() * 3.5).toFixed(1),
      estabilidade: +(1.5 + Math.random() * 3.5).toFixed(1),
    };
  });

  return (
    <div className="min-h-dvh bg-background pb-24 safe-area-top">
      <header className="flex items-center gap-3 px-5 py-4">
        <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={20} />
        </button>
        <h1 className="font-mono font-bold text-foreground text-sm">Evolução</h1>
      </header>

      <div className="px-5 mt-4">
        <EvolutionChart data={data} />
      </div>

      <BottomNav />
    </div>
  );
};

export default History;
