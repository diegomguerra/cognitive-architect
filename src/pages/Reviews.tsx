import { ArrowLeft, Calendar } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '@/components/BottomNav';

const demoReviews = [
  { date: 'Hoje', score: 72, summary: 'Boa energia matinal, foco moderado à tarde.' },
  { date: 'Ontem', score: 65, summary: 'Sono fragmentado impactou clareza.' },
  { date: '2 dias atrás', score: 80, summary: 'Excelente recuperação. Janela ampla de foco.' },
];

const Reviews = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh bg-background pb-24 safe-area-top">
      <header className="flex items-center gap-3 px-5 py-4">
        <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={20} />
        </button>
        <h1 className="font-mono font-bold text-foreground text-sm">Revisões Diárias</h1>
      </header>

      <div className="px-5 mt-4 space-y-3">
        {demoReviews.map((r, i) => (
          <div key={i} className="rounded-2xl bg-card border border-border p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Calendar size={14} className="text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{r.date}</span>
              </div>
              <span className="text-sm font-mono font-bold text-primary">{r.score}</span>
            </div>
            <p className="text-sm text-secondary-foreground">{r.summary}</p>
          </div>
        ))}
      </div>

      <BottomNav />
    </div>
  );
};

export default Reviews;
