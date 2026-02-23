import { useEffect, useState } from 'react';
import { FileText, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface Review {
  id: string;
  day: string;
  focus_score: number | null;
  clarity_score: number | null;
  energy_score: number | null;
  mood_score: number | null;
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

const ReviewsTab = () => {
  const { session } = useAuth();
  const [reviews, setReviews] = useState<Review[]>([]);

  useEffect(() => {
    if (!session?.user?.id) return;
    supabase.from('daily_reviews').select('*')
      .eq('user_id', session.user.id)
      .order('day', { ascending: false })
      .limit(30)
      .then(({ data }) => {
        if (data) setReviews(data);
      });
  }, [session?.user?.id]);

  if (reviews.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">Nenhuma revisão registrada</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {reviews.map((r) => {
        const avg = [r.focus_score, r.clarity_score, r.energy_score, r.mood_score]
          .filter((v): v is number => v != null);
        const mean = avg.length > 0 ? (avg.reduce((a, b) => a + b, 0) / avg.length).toFixed(1) : '—';

        return (
          <button
            key={r.id}
            className="w-full flex items-center gap-3 rounded-xl bg-card border border-border p-4 text-left transition-transform active:scale-[0.98]"
          >
            <FileText size={18} className="text-muted-foreground flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-foreground">{formatDate(r.day)}</span>
              <p className="text-xs text-muted-foreground mt-0.5">Média: {mean}/10</p>
            </div>
            <ChevronRight size={16} className="text-muted-foreground" />
          </button>
        );
      })}
    </div>
  );
};

export default ReviewsTab;
