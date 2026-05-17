import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useEmblaCarousel from 'embla-carousel-react';
import BottomNav from '@/components/BottomNav';
import { AppHeader } from '@/design-system/components/AppHeader';
import { supabase } from '@/integrations/supabase/client';
import { getBandLabel, bandTextClass } from '@/design-system/bands';

type DailyScore = { day: string; score: number };
type BestMonth = { monthName: string; avgScore: number; daysN: number };

export default function YearStoryScreen() {
  const nav = useNavigate();
  const year = new Date().getFullYear();
  const [emblaRef, embla] = useEmblaCarousel({ loop: false, align: 'center' });
  const [activeIdx, setActiveIdx] = useState(0);

  const [scores, setScores] = useState<DailyScore[]>([]);
  const [best, setBest] = useState<BestMonth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!embla) return;
    const onSelect = () => setActiveIdx(embla.selectedScrollSnap());
    embla.on('select', onSelect);
    onSelect();
    return () => { embla.off('select', onSelect); };
  }, [embla]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Não autenticado');

        const [scoresRes, bestRes] = await Promise.all([
          supabase.rpc('get_yearly_scores', { p_user_id: user.id, p_year: year }),
          supabase.rpc('get_best_month',    { p_user_id: user.id, p_year: year }),
        ]);

        if (scoresRes.error) throw scoresRes.error;
        if (bestRes.error)   throw bestRes.error;

        const scoreRows = (scoresRes.data ?? []) as Array<Record<string, unknown>>;
        const bestRows = (bestRes.data ?? []) as Array<Record<string, unknown>>;

        if (!cancelled) {
          setScores(scoreRows.map((r) => ({ day: r.day as string, score: Number(r.score) })));
          if (bestRows[0]) {
            setBest({
              monthName: (bestRows[0].month_name as string).trim(),
              avgScore: Number(bestRows[0].avg_score),
              daysN: Number(bestRows[0].days_n),
            });
          }
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [year]);

  const totalSlides = 2;
  const avgYear = scores.length ? scores.reduce((a, b) => a + b.score, 0) / scores.length : 0;

  return (
    <div className="min-h-dvh bg-ds-bg0 text-ds-ink0 pb-24" style={{ fontFamily: 'Inter, sans-serif' }}>
      <header className="px-4 safe-area-top">
        <AppHeader variant="detail" title={`SEU ${year}`} onBack={() => nav('/insights')} />
      </header>

      <main className="px-4 pt-2">
        {loading ? (
          <div className="py-20 text-center font-mono text-[11px] tracking-wide2 text-ds-ink2 uppercase">Carregando…</div>
        ) : error ? (
          <p className="text-ds-ink1 text-sm py-8">{error}</p>
        ) : scores.length === 0 ? (
          <p className="text-ds-ink1 text-sm py-8">
            Sem scores registrados em {year}. Use o anel por algumas semanas para gerar tua história.
          </p>
        ) : (
          <>
            <div className="overflow-hidden" ref={emblaRef}>
              <div className="flex">
                {/* Slide 1 — Intro */}
                <div className="flex-[0_0_100%] min-w-0 px-1 pt-8">
                  <div className="font-mono text-[10px] tracking-wide3 uppercase text-ds-ink2 mb-3">Capítulo 1</div>
                  <h1
                    className="text-[44px] font-light tracking-[-0.02em] leading-[1.05] text-ds-ink0 mb-6"
                    style={{ fontFamily: '"Inter Tight", Inter, sans-serif' }}
                  >
                    Tua história<br/>de {year}
                  </h1>
                  <p className="text-ds-ink1 text-base leading-relaxed">
                    {scores.length} dias registrados.
                    {best && <> Teu melhor mês foi <span className="text-ds-ink0">{best.monthName.toLowerCase()}</span>, com média <span className="text-ds-ink0">{best.avgScore}</span>.</>}
                  </p>
                  <div className="mt-8 font-mono text-[10px] tracking-wide2 uppercase text-ds-ink2">
                    Arraste pra continuar →
                  </div>
                </div>

                {/* Slide 2 — Scores */}
                <div className="flex-[0_0_100%] min-w-0 px-1 pt-8">
                  <div className="font-mono text-[10px] tracking-wide3 uppercase text-ds-ink2 mb-3">Capítulo 2</div>
                  <h2
                    className="text-[36px] font-light tracking-[-0.02em] leading-[1.05] text-ds-ink0 mb-6"
                    style={{ fontFamily: '"Inter Tight", Inter, sans-serif' }}
                  >
                    Tua média<br/>do ano
                  </h2>
                  <div
                    className={`font-mono text-[88px] tracking-[-0.04em] leading-none ${bandTextClass(avgYear)}`}
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {avgYear.toFixed(1)}
                  </div>
                  <div className={`font-mono text-[11px] tracking-wide2 uppercase mt-2 ${bandTextClass(avgYear)}`}>
                    {getBandLabel(avgYear)}
                  </div>

                  {/* Grid de 365 dias mini-heatmap */}
                  <div className="mt-8">
                    <div className="font-mono text-[10px] tracking-wide2 uppercase text-ds-ink2 mb-3">
                      {scores.length} dias
                    </div>
                    <div className="flex flex-wrap gap-[2px]">
                      {scores.map((d) => (
                        <span
                          key={d.day}
                          className="w-[6px] h-[6px] rounded-[1px]"
                          style={{ backgroundColor: scoreToHex(d.score) }}
                          title={`${d.day}: ${d.score}`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Pagination dots */}
            <div className="flex justify-center gap-2 mt-8">
              {Array.from({ length: totalSlides }).map((_, i) => (
                <span
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full ${i === activeIdx ? 'bg-ds-ink0' : 'bg-white/[0.2]'}`}
                />
              ))}
            </div>
          </>
        )}
      </main>

      <BottomNav />
    </div>
  );
}

function scoreToHex(score: number): string {
  if (score >= 85) return '#7CC4FF';   // opt
  if (score >= 70) return '#9DD49D';   // good
  if (score >= 60) return '#E8C77A';   // fair
  return '#D27474';                     // low
}
