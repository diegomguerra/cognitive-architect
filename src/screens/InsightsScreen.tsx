import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import BottomNav from '@/components/BottomNav';
import { AppHeader } from '@/design-system/components/AppHeader';
import { DateRow } from '@/design-system/components/DateRow';
import { IndexCard } from '@/design-system/components/IndexCard';
import { Sparkline7d } from '@/design-system/components/Sparkline7d';
import { InsightCard } from '@/design-system/components/InsightCard';
import { BandLegend } from '@/design-system/components/BandLegend';
import { TagPill } from '@/design-system/components/TagPill';
import { BiomarkersGrid } from '@/design-system/components/BiomarkersGrid';
import { useInsightsData } from '@/design-system/useInsightsData';
import { useTags, FIXED_TAGS } from '@/features/tags/use-tags';
import { TagInputModal } from '@/features/tags/TagInputModal';

export default function InsightsScreen() {
  const nav = useNavigate();
  const { data, loading, error } = useInsightsData();
  const today = new Date().toISOString().slice(0, 10);
  const { tags, remove } = useTags(today);
  const [tagModalOpen, setTagModalOpen] = useState(false);

  const tagLabel = (code: string) => FIXED_TAGS.find((f) => f.code === code)?.label ?? code;

  if (loading) {
    return (
      <div className="min-h-dvh bg-ds-bg0 text-ds-ink0 flex items-center justify-center font-mono text-[11px] tracking-wide2 text-ds-ink2 uppercase">
        Carregando…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-dvh bg-ds-bg0 text-ds-ink0 px-4 safe-area-top pb-24" style={{ fontFamily: 'Inter, sans-serif' }}>
        <AppHeader variant="home" />
        <p className="text-ds-ink1 text-sm mt-12">{error || 'Sem dados disponíveis no momento.'}</p>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-ds-bg0 text-ds-ink0 pb-24" style={{ fontFamily: 'Inter, sans-serif' }}>
      <header className="px-4 safe-area-top">
        <AppHeader variant="home" />
      </header>

      <main className="px-4 pt-2">
        <DateRow date={data.day} />

        {/* Header da seção — Insights foca nos 3 índices + biomarcadores. VYR State fica só na Home. */}
        <h1
          className="text-[28px] font-light tracking-[-0.02em] text-ds-ink0 mb-6 px-1"
          style={{ fontFamily: '"Inter Tight", Inter, sans-serif' }}
        >
          Seus eixos
        </h1>

        {/* 3 índices grid */}
        <div className="grid grid-cols-3 gap-2 px-1 mb-6">
          <IndexCard label="Energia"      value={data.pillars.energia}      onClick={() => nav('/insights/energia')} />
          <IndexCard label="Clareza"      value={data.pillars.clareza}      onClick={() => nav('/insights/clareza')} />
          <IndexCard label="Estabilidade" value={data.pillars.estabilidade} onClick={() => nav('/insights/estabilidade')} />
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-1.5 px-1 py-4">
          {tags.map((t) => (
            <TagPill
              key={t.id}
              label={tagLabel(t.tagCode)}
              active
              removable
              onRemove={() => remove(t.id)}
            />
          ))}
          <TagPill label="+ Adicionar tag" onPress={() => setTagModalOpen(true)} />
        </div>

        {/* Sparkline 7 dias */}
        {data.last7Days.length > 0 && (
          <Sparkline7d
            days={data.last7Days.map((d) => ({ label: d.d, score: d.score ?? 0 }))}
            avg={data.last7Days.filter((d) => d.score != null).reduce((a, b) => a + (b.score as number), 0) / Math.max(1, data.last7Days.filter((d) => d.score != null).length)}
          />
        )}

        {/* Biomarcadores 24h — cards visuais */}
        <BiomarkersGrid />

        {/* Cause / pilar limitante */}
        {data.cause && (
          <InsightCard
            label="Pilar limitante"
            variant={(data.vyrState ?? 100) < 60 ? 'risk' : 'neutral'}
            text={<>{data.cause.explanation}</>}
          />
        )}

        {/* Legenda das faixas */}
        <div className="px-1 pt-8 pb-4 border-t border-white/[0.08] mt-8">
          <div className="font-mono text-[11px] tracking-wide2 text-ds-ink2 uppercase mb-4">
            Faixas de excelência
          </div>
          <BandLegend />
        </div>

        {/* Botões pra Daily State + Year Story */}
        <div className="grid grid-cols-2 gap-2 mt-6 px-1">
          <button
            onClick={() => nav('/insights/daily-state')}
            className="font-mono text-[11px] tracking-wide2 uppercase py-3 border border-white/[0.15] rounded-[3px] text-ds-ink1 hover:text-ds-ink0 hover:border-ds-ink0"
          >
            Estado · dia
          </button>
          <button
            onClick={() => nav('/insights/year-story')}
            className="font-mono text-[11px] tracking-wide2 uppercase py-3 border border-white/[0.15] rounded-[3px] text-ds-ink1 hover:text-ds-ink0 hover:border-ds-ink0"
          >
            Seu ano
          </button>
        </div>
      </main>

      <TagInputModal day={today} open={tagModalOpen} onClose={() => setTagModalOpen(false)} />
      <BottomNav />
    </div>
  );
}
