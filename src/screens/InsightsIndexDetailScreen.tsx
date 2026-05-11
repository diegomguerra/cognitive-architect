import { useParams, useNavigate } from 'react-router-dom';
import BottomNav from '@/components/BottomNav';
import { AppHeader } from '@/design-system/components/AppHeader';
import { HeroScore } from '@/design-system/components/HeroScore';
import { EditorialBlock } from '@/design-system/components/EditorialBlock';
import { ContributorRow } from '@/design-system/components/ContributorRow';
import { Sparkline7d } from '@/design-system/components/Sparkline7d';
import { useInsightsData, type IndexType } from '@/design-system/useInsightsData';

const TITLES: Record<IndexType, string> = {
  energia: 'ENERGIA',
  clareza: 'CLAREZA',
  estabilidade: 'ESTABILIDADE',
};

export default function InsightsIndexDetailScreen() {
  const { type } = useParams<{ type: IndexType }>();
  const nav = useNavigate();
  const { data, loading, error } = useInsightsData();

  const validType: IndexType | null =
    type === 'energia' || type === 'clareza' || type === 'estabilidade' ? type : null;

  if (!validType) {
    return (
      <div className="min-h-dvh bg-ds-bg0 text-ds-ink0 px-4 pt-12">
        <AppHeader variant="detail" title="ERRO" onBack={() => nav('/insights')} />
        <p className="text-ds-ink1 text-sm mt-6">Tipo de índice inválido.</p>
        <BottomNav />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-dvh bg-ds-bg0 text-ds-ink0 flex items-center justify-center font-mono text-[11px] tracking-wide2 text-ds-ink2 uppercase">
        Carregando…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-dvh bg-ds-bg0 text-ds-ink0 px-4 pt-12">
        <AppHeader variant="detail" title={TITLES[validType]} onBack={() => nav('/insights')} />
        <p className="text-ds-ink1 text-sm mt-6">{error || 'Sem dados.'}</p>
        <BottomNav />
      </div>
    );
  }

  const score = data.pillars[validType];
  const contributors = data.contributors[validType] || [];
  const editorial = data.editorial[validType];

  return (
    <div className="min-h-dvh bg-ds-bg0 text-ds-ink0 pb-24" style={{ fontFamily: 'Inter, sans-serif' }}>
      <header className="px-4 pt-12">
        <AppHeader variant="detail" title={TITLES[validType]} onBack={() => nav('/insights')} />
      </header>

      <main className="px-4 pt-4">
        <HeroScore label="" value={score} size="lg" />

        {editorial.heading && (
          <EditorialBlock heading={editorial.heading} body={editorial.body} />
        )}

        <section className="px-1 pb-6">
          <h3
            className="text-[22px] font-light tracking-[-0.01em] mb-5 text-ds-ink0"
            style={{ fontFamily: '"Inter Tight", Inter, sans-serif' }}
          >
            Contribuidores
          </h3>
          {contributors.length === 0 ? (
            <p className="text-sm text-ds-ink1 py-4">
              Sem contribuidores disponíveis. Sincronize o anel para acumular dados.
            </p>
          ) : (
            contributors.map((c) => (
              <ContributorRow
                key={c.name}
                name={c.name}
                rawValue={c.rawValue}
                score={c.score}
                qualityNote={c.qualityNote}
              />
            ))
          )}
        </section>

        {data.last7Days.length > 0 && (
          <Sparkline7d
            days={data.last7Days.map((d) => ({ label: d.d, score: d.score ?? 0 }))}
            avg={data.last7Days.filter((d) => d.score != null).reduce((a, b) => a + (b.score as number), 0) / Math.max(1, data.last7Days.filter((d) => d.score != null).length)}
          />
        )}
      </main>

      <BottomNav />
    </div>
  );
}
