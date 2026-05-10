import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import { HeroScore } from '@/design-system/components/HeroScore';
import { IndexCard } from '@/design-system/components/IndexCard';
import { EditorialBlock } from '@/design-system/components/EditorialBlock';
import { ContributorRow } from '@/design-system/components/ContributorRow';
import { Sparkline7d } from '@/design-system/components/Sparkline7d';
import { InsightCard } from '@/design-system/components/InsightCard';
import { BandLegend } from '@/design-system/components/BandLegend';
import { useInsightsData } from '@/design-system/useInsightsData';

/**
 * InsightsScreen — Home alternativa estilo Oura/VYR Design System v1.
 * Substitui a Home tradicional para usuários que escolherem a aba "Insights"
 * no bottom nav. Mantém Home original intacta.
 */
export default function InsightsScreen() {
  const nav = useNavigate();
  const { data, loading, error } = useInsightsData();

  if (loading) {
    return (
      <div className="min-h-dvh bg-ds-bg0 text-ds-ink0 flex items-center justify-center font-mono text-[11px] tracking-wide2 text-ds-ink2 uppercase">
        Carregando…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-dvh bg-ds-bg0 text-ds-ink0 px-4 pt-12 pb-24">
        <button onClick={() => nav('/')} className="text-ds-ink1 inline-flex items-center gap-2 mb-6">
          <ArrowLeft size={16} /> <span className="font-mono text-[11px] tracking-wide2 uppercase">Voltar</span>
        </button>
        <h1 className="font-mono text-[11px] tracking-wide3 text-ds-ink2 uppercase mb-3">Insights</h1>
        <p className="text-ds-ink1 text-sm">{error || 'Sem dados disponíveis no momento.'}</p>
        <BottomNav />
      </div>
    );
  }

  const today = new Date(data.day).toLocaleDateString('pt-BR', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  }).toUpperCase();

  return (
    <div className="min-h-dvh bg-ds-bg0 text-ds-ink0 pb-24" style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* App bar */}
      <header className="px-4 pt-12 pb-2 flex justify-between items-center">
        <button onClick={() => nav('/')} className="text-ds-ink1 hover:text-ds-ink0">
          <ArrowLeft size={20} />
        </button>
        <span className="font-mono text-[11px] font-medium tracking-wide3 text-ds-ink0">VYR LABS</span>
        <span className="w-5" />
      </header>

      <main className="px-4">
        <div className="font-mono text-[11px] tracking-wide2 text-ds-ink2 text-center uppercase mb-6 mt-2">
          {today}
        </div>

        {/* HERO VYR State */}
        <HeroScore label="VYR STATE" value={data.vyrState} size="lg" />

        {/* Editorial */}
        <EditorialBlock heading={data.editorial.heading} body={data.editorial.body} />

        {/* 3 índices grid */}
        <div className="grid grid-cols-3 gap-2 px-1 mb-6">
          <IndexCard label="Energia"      value={data.pillars.energia}      onClick={() => nav('/insights/energia')} />
          <IndexCard label="Clareza"      value={data.pillars.clareza}      onClick={() => nav('/insights/clareza')} />
          <IndexCard label="Estabilidade" value={data.pillars.estabilidade} onClick={() => nav('/insights/estabilidade')} />
        </div>

        {/* Sparkline 7 dias do VYR State */}
        <Sparkline7d
          days={data.last7Days.map((d) => ({ label: d.d, score: d.score }))}
          avg={data.last7Days.reduce((a, b) => a + b.score, 0) / data.last7Days.length}
        />

        {/* Insight automático — mostrar pillar mais baixo como atenção */}
        {(() => {
          const entries = Object.entries(data.pillars) as [string, number][];
          entries.sort((a, b) => a[1] - b[1]);
          const [name, val] = entries[0];
          if (val >= 70) {
            return (
              <InsightCard
                label="Padrão detectado"
                variant="positive"
                text={<>Os 3 pilares estão acima de 70 — janela de operação cognitiva consistente.</>}
              />
            );
          }
          return (
            <InsightCard
              label="Pilar limitante"
              variant={val < 60 ? 'risk' : 'neutral'}
              text={<><b className="capitalize">{name}</b> está em <b>{val}</b> — pilar mais baixo. Toque pra ver os contribuidores.</>}
            />
          );
        })()}

        {/* Legenda das faixas (educational) */}
        <div className="px-1 pt-8 pb-4 border-t border-white/[0.08] mt-8">
          <div className="font-mono text-[11px] tracking-wide2 text-ds-ink2 uppercase mb-4">
            Faixas de excelência
          </div>
          <BandLegend />
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
