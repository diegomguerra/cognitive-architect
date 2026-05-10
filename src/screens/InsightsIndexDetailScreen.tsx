import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
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

const BODIES: Record<IndexType, string> = {
  energia:
    'Mede prontidão física e bioenergética: FC repouso, sono, oxigenação e gasto energético do dia anterior.',
  clareza:
    'Mede recuperação cognitiva e equilíbrio autonômico: HRV, qualidade do sono, estresse e respiração.',
  estabilidade:
    'Mede consistência ao longo do tempo: tendência da HRV, regularidade circadiana, temperatura corporal.',
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
        <button onClick={() => nav('/insights')} className="text-ds-ink1 inline-flex items-center gap-2">
          <ArrowLeft size={16} /> <span className="font-mono text-[11px] tracking-wide2 uppercase">Insights</span>
        </button>
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
        <p className="text-ds-ink1 text-sm">{error || 'Sem dados.'}</p>
        <BottomNav />
      </div>
    );
  }

  const score = data.pillars[validType];
  const contributors = data.contributors[validType];

  return (
    <div className="min-h-dvh bg-ds-bg0 text-ds-ink0 pb-24" style={{ fontFamily: 'Inter, sans-serif' }}>
      <header className="px-4 pt-12 pb-2 flex justify-between items-center">
        <button onClick={() => nav('/insights')} className="text-ds-ink1 hover:text-ds-ink0">
          <ArrowLeft size={20} />
        </button>
        <span className="font-mono text-[11px] font-medium tracking-wide3 text-ds-ink0">
          {TITLES[validType]}
        </span>
        <span className="w-5" />
      </header>

      <main className="px-4 pt-4">
        <HeroScore label="" value={score} size="lg" />

        <EditorialBlock
          heading={`Eixo ${TITLES[validType].toLowerCase()}`}
          body={BODIES[validType]}
        />

        <section className="px-1 pb-6">
          <h3
            className="text-[22px] font-light tracking-[-0.01em] mb-5 text-ds-ink0"
            style={{ fontFamily: '"Inter Tight", Inter, sans-serif' }}
          >
            Contribuidores
          </h3>
          {contributors.length === 0 ? (
            <p className="text-sm text-ds-ink1 py-4">
              Sem contribuidores disponíveis para este eixo nos dados atuais. Sincronize o anel para expandir a coleta.
            </p>
          ) : (
            contributors.map((c) => (
              <ContributorRow
                key={c.name}
                name={c.name}
                rawValue={c.rawValue}
                score={c.score}
              />
            ))
          )}
        </section>

        <Sparkline7d
          days={data.last7Days.map((d) => ({ label: d.d, score: d.score }))}
          avg={data.last7Days.reduce((a, b) => a + b.score, 0) / data.last7Days.length}
        />
      </main>

      <BottomNav />
    </div>
  );
}
