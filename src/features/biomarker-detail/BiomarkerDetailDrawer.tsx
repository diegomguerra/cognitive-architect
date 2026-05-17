import { useEffect, useMemo, useState } from 'react';
import { X, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useBiomarkerSeries, METRIC_QUERY, type Range } from './use-biomarker-series';

export type DrawerCard = {
  key: string;
  label: string;
  Icon: LucideIcon;
  value: string;
  rawNum: number | null;
  unit: string;
  decimals: number;
  typical: [number, number];
  /** Range fisiológico amplo (ex HR 30-220, SpO2 88-100, etc) */
  physiological?: [number, number];
  colorVar: string;     // CSS var, ex '--hr-c'
  sourceLabel?: string;
};

type Props = { card: DrawerCard; onClose: () => void };

const PHYSIO: Record<string, [number, number]> = {
  hr: [40, 200], rhr: [40, 100], hrv: [10, 120], rr: [400, 1500],
  sleep: [0, 12], spo2: [85, 100], temp: [35, 39], stress: [0, 100],
  steps: [0, 20000], ppg: [0, 30000],
};

function fmt(v: number | null | undefined, decimals = 0): string {
  if (v == null || isNaN(v)) return '—';
  if (Math.abs(v) >= 1000) return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  return decimals > 0 ? v.toFixed(decimals).replace('.', ',') : Math.round(v).toString();
}

const RANGE_TABS: { key: Range; label: string }[] = [
  { key: 'day',   label: 'Dia' },
  { key: 'week',  label: 'Semana' },
  { key: 'month', label: 'Mês' },
];

const DELTA_LABEL: Record<Range, string> = {
  day:   'hoje vs média 24h',
  week:  'hoje vs média 7d',
  month: 'hoje vs média 30d',
};

export function BiomarkerDetailDrawer({ card, onClose }: Props) {
  const [range, setRange] = useState<Range>('day');
  const query = METRIC_QUERY[card.key];
  const colorCss = `var(${card.colorVar})`;
  const physio = card.physiological ?? PHYSIO[card.key] ?? [0, 100];

  const { data: series, loading } = useBiomarkerSeries(range, {
    types: query.types,
    validRange: query.validRange,
    reducer: query.reducer,
    scale: query.scale,
  });

  // ESC fecha; bloqueia scroll do body enquanto aberto
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const stats = useMemo(() => {
    if (!series || series.length === 0) return null;
    const vals = series.map((p) => p.value).filter((v) => v != null);
    if (vals.length === 0) return null;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return { min, max, avg };
  }, [series]);

  const delta = stats && card.rawNum != null ? card.rawNum - stats.avg : null;
  const deltaPct = (delta != null && stats && stats.avg) ? Math.round((delta / stats.avg) * 100) : null;
  const flat = deltaPct != null && Math.abs(deltaPct) < 2;
  const up = !flat && delta != null && delta > 0;
  const TrendIcon = flat ? Minus : up ? TrendingUp : TrendingDown;
  const deltaColor = flat ? 'text-ds-ink1 border-ds-ink2'
                  : up   ? 'text-emerald-300 border-emerald-300/70'
                         : 'text-rose-300 border-rose-300/70';

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      {/* scrim */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      {/* drawer */}
      <div
        className="absolute left-0 right-0 bottom-0 mx-auto max-w-[480px] max-h-[92vh] overflow-y-auto bg-ds-bg1 rounded-t-[24px] border-t border-white/[0.15] shadow-2xl"
        style={{
          ['--accent-c' as never]: colorCss,
          animation: 'vyrDrawerIn .32s cubic-bezier(.2,.8,.2,1)',
        }}
      >
        <style>{`
          @keyframes vyrDrawerIn {
            from { transform: translateY(100%); }
            to   { transform: translateY(0); }
          }
        `}</style>

        {/* handle */}
        <div className="w-10 h-1 bg-ds-ink3 rounded-full mx-auto mt-2.5" />

        {/* header */}
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-center gap-2.5 mb-3.5">
            <span className="flex items-center justify-center w-[38px] h-[38px] rounded-[11px] bg-ds-bg2 border border-white/[0.08]" style={{ color: colorCss }}>
              <card.Icon size={18} strokeWidth={1.6} />
            </span>
            <div className="flex-1">
              <div className="font-mono text-[10px] tracking-widest uppercase text-ds-ink2">
                Biomarcador
              </div>
              <div className="text-[22px] font-light tracking-tight text-ds-ink0" style={{ fontFamily: '"Inter Tight", Inter, sans-serif' }}>
                {card.label}
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full border border-white/[0.15] flex items-center justify-center text-ds-ink1 hover:text-ds-ink0 hover:border-white/[0.3]"
              aria-label="Fechar"
            >
              <X size={16} strokeWidth={2} />
            </button>
          </div>

          <div className="flex items-baseline gap-2 mt-2 flex-wrap">
            <span className="font-mono text-[56px] font-medium leading-none tracking-[-0.03em] text-ds-ink0" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {card.value}
            </span>
            {card.unit && <span className="font-mono text-[18px] text-ds-ink1">{card.unit}</span>}
            {delta != null && (
              <span className={`ml-auto inline-flex items-center gap-1.5 font-mono text-[12px] font-medium tracking-wide1 uppercase px-2.5 py-1 border rounded-full ${deltaColor}`}>
                <TrendIcon size={12} strokeWidth={2.4} />
                {delta > 0 ? '+' : ''}{fmt(delta, card.decimals)} {card.unit}
              </span>
            )}
          </div>
          {deltaPct != null && (
            <div className="font-mono text-[11px] tracking-wider uppercase text-ds-ink1 mt-2.5">
              {DELTA_LABEL[range]} · {deltaPct > 0 ? '+' : ''}{deltaPct}%
            </div>
          )}
        </div>

        {/* tabs */}
        <div className="mx-5 mt-1 p-[3px] bg-ds-bg0 border border-white/[0.08] rounded-full grid grid-cols-3">
          {RANGE_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setRange(t.key)}
              className={`font-mono text-[11px] tracking-widest uppercase py-2.5 rounded-full transition-colors ${
                range === t.key
                  ? 'bg-ds-bg2 text-ds-ink0'
                  : 'text-ds-ink1 hover:text-ds-ink0'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* chart */}
        <div className="px-4 pt-6 pb-2">
          <div className="bg-ds-bg2 border border-white/[0.08] rounded-2xl p-4 pb-3 min-h-[240px]">
            {loading && (
              <div className="font-mono text-[11px] uppercase tracking-widest text-ds-ink1 py-20 text-center">
                Carregando série…
              </div>
            )}
            {!loading && (!series || series.every((p) => p.value === 0)) && (
              <div className="font-mono text-[11px] uppercase tracking-widest text-ds-ink1 py-20 text-center">
                Sem dados nessa janela
              </div>
            )}
            {!loading && series && series.some((p) => p.value !== 0) && (
              <DetailChart
                series={series}
                typical={card.typical}
                physio={physio}
                decimals={card.decimals}
                chartType={query.chartType}
                colorCss={colorCss}
              />
            )}
          </div>
        </div>

        {/* stats */}
        {stats && (
          <div className="px-4 pt-3 grid grid-cols-3 gap-3">
            {[
              { label: 'Mín',   val: stats.min },
              { label: 'Média', val: stats.avg },
              { label: 'Máx',   val: stats.max },
            ].map((s) => (
              <div key={s.label} className="bg-ds-bg2 border border-white/[0.08] rounded-xl p-3 text-center">
                <div className="font-mono text-[10px] tracking-widest uppercase text-ds-ink1 mb-1.5">{s.label}</div>
                <div className="font-mono text-[20px] font-medium tracking-tight text-ds-ink0" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(s.val, card.decimals)}<span className="text-[12px] text-ds-ink1 ml-1">{card.unit}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* faixas */}
        <div className="mx-4 mt-4 p-4 bg-ds-bg2 border border-white/[0.08] rounded-xl flex flex-col gap-2">
          <div className="flex items-center justify-between font-mono uppercase">
            <span className="text-[11px] tracking-wide1 text-ds-ink1">Faixa típica (você)</span>
            <span className="text-[12px] font-medium tracking-wide1 text-ds-ink0" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {fmt(card.typical[0], card.decimals)}–{fmt(card.typical[1], card.decimals)} {card.unit}
            </span>
          </div>
          <div className="flex items-center justify-between font-mono uppercase">
            <span className="text-[11px] tracking-wide1 text-ds-ink1">Faixa fisiológica</span>
            <span className="text-[12px] font-medium tracking-wide1 text-ds-ink0" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {fmt(physio[0], card.decimals)}–{fmt(physio[1], card.decimals)} {card.unit}
            </span>
          </div>
          {card.sourceLabel && (
            <div className="font-mono text-[11px] tracking-wide1 uppercase text-ds-ink1 pt-1 border-t border-white/[0.08] mt-1">
              Fonte · {card.sourceLabel}
            </div>
          )}
        </div>

        <div className="h-8" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* DetailChart — SVG inline (line ou bar) com banda da faixa típica   */
/* ------------------------------------------------------------------ */
type ChartProps = {
  series: { value: number; label: string }[];
  typical: [number, number];
  physio: [number, number];
  decimals: number;
  chartType: 'line' | 'bar';
  colorCss: string;
};

function DetailChart({ series, typical, physio, decimals, chartType, colorCss }: ChartProps) {
  const W = 380, H = 200, PAD_L = 32, PAD_R = 8, PAD_T = 14, PAD_B = 22;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const n = series.length;
  const vals = series.map((p) => p.value).filter((v) => v != null);
  const dataMin = Math.min(...vals, typical[0]);
  const dataMax = Math.max(...vals, typical[1]);
  const padY = (dataMax - dataMin) * 0.15 || Math.max(1, Math.abs(dataMax) * 0.1);
  const yMin = Math.max(physio[0], dataMin - padY);
  const yMax = Math.min(physio[1], dataMax + padY);
  const yScale = (v: number) => PAD_T + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;
  const xStep = n > 1 ? innerW / (n - 1) : 0;
  const barW = n > 0 ? innerW / n - 2 : 0;

  // banda da faixa típica
  const bandTop = yScale(Math.min(typical[1], yMax));
  const bandBot = yScale(Math.max(typical[0], yMin));

  // ticks Y (3 níveis)
  const yT0 = yMin, yT1 = (yMin + yMax) / 2, yT2 = yMax;

  // X labels: pega ~6 amostras igualmente espaçadas
  const xTickIdx: number[] = [];
  if (n > 1) {
    const step = Math.max(1, Math.floor(n / 5));
    for (let i = 0; i < n; i += step) xTickIdx.push(i);
    if (xTickIdx[xTickIdx.length - 1] !== n - 1) xTickIdx.push(n - 1);
  }

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[200px] block" style={{ color: colorCss }} preserveAspectRatio="none">
        {/* grid horizontal */}
        {[0, 1, 2, 3, 4].map((i) => (
          <line key={i} x1={PAD_L} y1={PAD_T + (innerH * i / 4)} x2={W - PAD_R} y2={PAD_T + (innerH * i / 4)}
                stroke="rgba(255,255,255,0.08)" strokeWidth={1} strokeDasharray="2 4" />
        ))}
        {/* Y axis labels */}
        <text x={4} y={PAD_T + 4} className="font-mono" fontSize={9} fill="rgba(255,255,255,0.55)">{fmt(yT2, decimals)}</text>
        <text x={4} y={PAD_T + innerH / 2 + 3} className="font-mono" fontSize={9} fill="rgba(255,255,255,0.55)">{fmt(yT1, decimals)}</text>
        <text x={4} y={PAD_T + innerH + 2} className="font-mono" fontSize={9} fill="rgba(255,255,255,0.55)">{fmt(yT0, decimals)}</text>

        {/* typical band */}
        <rect x={PAD_L} y={Math.min(bandTop, bandBot)} width={innerW} height={Math.abs(bandBot - bandTop)}
              fill="currentColor" opacity={0.10} rx={3} />

        {/* data */}
        {chartType === 'bar' ? (
          series.map((p, i) => {
            const x = PAD_L + i * (innerW / n) + 1;
            const y = yScale(p.value);
            const h = (PAD_T + innerH) - y;
            const today = i === n - 1;
            return <rect key={i} x={x} y={y} width={barW} height={Math.max(0, h)}
                          fill="currentColor" opacity={today ? 1 : 0.55} rx={2} />;
          })
        ) : (
          (() => {
            let d = '', dArea = '';
            series.forEach((p, i) => {
              const x = PAD_L + i * xStep;
              const y = yScale(p.value);
              if (i === 0) { d += `M ${x} ${y}`; dArea += `M ${x} ${PAD_T + innerH} L ${x} ${y}`; }
              else { d += ` L ${x} ${y}`; dArea += ` L ${x} ${y}`; }
            });
            dArea += ` L ${PAD_L + (n - 1) * xStep} ${PAD_T + innerH} Z`;
            const lastX = PAD_L + (n - 1) * xStep;
            const lastY = yScale(series[n - 1].value);
            return (
              <>
                <path d={dArea} fill="currentColor" opacity={0.18} />
                <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                {/* dots a cada ~6 pontos + ponto final destacado */}
                {series.map((p, i) => {
                  const isLast = i === n - 1;
                  if (!isLast && i % Math.max(1, Math.floor(n / 6)) !== 0) return null;
                  const x = PAD_L + i * xStep;
                  const y = yScale(p.value);
                  return isLast
                    ? <circle key={i} cx={x} cy={y} r={4.5} fill="currentColor" stroke="#e5e7eb" strokeWidth={1.5} />
                    : <circle key={i} cx={x} cy={y} r={3} fill="#0f1116" stroke="currentColor" strokeWidth={2} />;
                })}
                {/* keep lastX/lastY referenced */}
                <g style={{ display: 'none' }}>{lastX}{lastY}</g>
              </>
            );
          })()
        )}
      </svg>
      <div className="flex justify-between mt-1.5 px-1 font-mono text-[10px] tracking-wide1 uppercase text-ds-ink1">
        {xTickIdx.map((i) => <span key={i}>{series[i]?.label ?? ''}</span>)}
      </div>
    </>
  );
}
