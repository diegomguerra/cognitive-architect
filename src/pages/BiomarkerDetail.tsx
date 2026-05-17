import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Heart, Activity, Moon, Droplets, Thermometer, Brain, Zap, Footprints, Waves, HeartPulse, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useBiomarkerSeries, METRIC_QUERY, type Range } from '@/features/biomarker-detail/use-biomarker-series';

/* ============================================================
   Metadata por biomarker — mantém em sync com BiomarkersGrid
   ============================================================ */
const META: Record<string, {
  label: string;
  Icon: LucideIcon;
  unit: string;
  decimals: number;
  typical: [number, number];
  physiological: [number, number];
  colorVar: string;
  colorFallback: string;
}> = {
  hr:     { label: 'Freq. Cardíaca', Icon: Heart,       unit: 'bpm', decimals: 0, typical: [58, 88],  physiological: [40, 200], colorVar: '--hr-c',     colorFallback: 'hsl(340 70% 70%)' },
  rhr:    { label: 'FC de Repouso',  Icon: HeartPulse,  unit: 'bpm', decimals: 0, typical: [52, 62],  physiological: [40, 100], colorVar: '--rhr-c',    colorFallback: 'hsl(340 70% 60%)' },
  hrv:    { label: 'HRV (RMSSD)',    Icon: Activity,    unit: 'ms',  decimals: 0, typical: [35, 70],  physiological: [10, 120], colorVar: '--hrv-c',    colorFallback: 'hsl(265 65% 75%)' },
  rr:     { label: 'Intervalos RR',  Icon: Waves,       unit: 'ms',  decimals: 0, typical: [780, 950], physiological: [400, 1500], colorVar: '--rr-c', colorFallback: 'hsl(195 55% 70%)' },
  sleep:  { label: 'Sono',           Icon: Moon,        unit: 'h',   decimals: 1, typical: [7, 9],    physiological: [0, 12],   colorVar: '--sleep-c',  colorFallback: 'hsl(240 60% 70%)' },
  spo2:   { label: 'SpO₂',           Icon: Droplets,    unit: '%',   decimals: 0, typical: [95, 99],  physiological: [85, 100], colorVar: '--spo2-c',   colorFallback: 'hsl(190 70% 70%)' },
  temp:   { label: 'Temperatura',    Icon: Thermometer, unit: '°C',  decimals: 1, typical: [36, 36.8], physiological: [35, 39], colorVar: '--temp-c',   colorFallback: 'hsl(20 80% 65%)' },
  stress: { label: 'Estresse',       Icon: Brain,       unit: '',    decimals: 0, typical: [20, 50],  physiological: [0, 100],  colorVar: '--stress-c', colorFallback: 'hsl(42 80% 65%)' },
  steps:  { label: 'Passos',         Icon: Footprints,  unit: '',    decimals: 0, typical: [6000, 12000], physiological: [0, 20000], colorVar: '--steps-c', colorFallback: 'hsl(40 80% 60%)' },
  ppg:    { label: 'PPG (raw)',      Icon: Zap,         unit: 'amostras', decimals: 0, typical: [10000, 25000], physiological: [0, 30000], colorVar: '--ppg-c', colorFallback: 'hsl(50 90% 60%)' },
};

const RANGE_TABS: { key: Range; label: string }[] = [
  { key: 'day', label: 'Dia' },
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mês' },
];

const DELTA_LABEL: Record<Range, string> = {
  day:   'agora vs média 24h',
  week:  'agora vs média 7d',
  month: 'agora vs média 30d',
};

function fmt(v: number | null | undefined, decimals = 0): string {
  if (v == null || isNaN(v)) return '—';
  if (Math.abs(v) >= 1000) return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  return decimals > 0 ? v.toFixed(decimals).replace('.', ',') : Math.round(v).toString();
}

export default function BiomarkerDetail() {
  const { key } = useParams<{ key: string }>();
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>('day');
  const [ringLabel, setRingLabel] = useState<string>('Anel');
  const [currentValue, setCurrentValue] = useState<number | null>(null);

  const meta = key && META[key];
  const query = key && METRIC_QUERY[key];

  // Fetch dispatch — sempre chamado mesmo se invalid pra manter ordem dos hooks
  const safeKey = (key && META[key]) ? key : 'hr';
  const safeQuery = METRIC_QUERY[safeKey];
  const { data: series, loading } = useBiomarkerSeries(range, {
    types: safeQuery.types,
    validRange: safeQuery.validRange,
    reducer: safeQuery.reducer,
    scale: safeQuery.scale,
  });

  // Lookup device vendor pra source label
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: devs } = await supabase
        .from('devices')
        .select('vendor, model')
        .eq('user_id', user.id)
        .order('last_seen_at', { ascending: false })
        .limit(1);
      if (cancelled) return;
      const d = devs?.[0];
      if (d) {
        const v = d.vendor === 'colmi' ? 'Colmi' : d.vendor === 'jstyle' ? 'JStyle' : d.vendor;
        setRingLabel(`${v} ${d.model ?? ''}`.trim());
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch último valor do anchor day pra exibir como "valor agora"
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !query) return;
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data } = await supabase
        .from('biomarker_samples')
        .select('value')
        .eq('user_id', user.id)
        .in('type', query.types)
        .gte('ts', since)
        .order('ts', { ascending: false })
        .limit(1);
      if (cancelled) return;
      const v = data?.[0]?.value;
      setCurrentValue(typeof v === 'number' ? v : null);
    })();
    return () => { cancelled = true; };
  }, [key]);

  if (!key || !meta || !query) {
    return (
      <div className="min-h-screen bg-ds-bg0 text-ds-ink0 p-6">
        <button onClick={() => navigate(-1)} className="font-mono text-sm uppercase tracking-wider text-ds-ink1 hover:text-ds-ink0">
          ← Voltar
        </button>
        <div className="mt-8 font-mono text-sm text-ds-ink1">Biomarcador não encontrado: {key}</div>
      </div>
    );
  }

  const colorCss = `var(${meta.colorVar})`;

  const stats = useMemo(() => {
    if (!series || series.length === 0) return null;
    const vals = series.map((p) => p.value).filter((v) => v != null);
    if (vals.length === 0) return null;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return { min, max, avg };
  }, [series]);

  const delta = stats && currentValue != null ? currentValue - stats.avg : null;
  const deltaPct = (delta != null && stats && stats.avg) ? Math.round((delta / stats.avg) * 100) : null;
  const flat = deltaPct != null && Math.abs(deltaPct) < 2;
  const up = !flat && delta != null && delta > 0;
  const TrendIcon = flat ? Minus : up ? TrendingUp : TrendingDown;
  const deltaColor = flat ? 'text-ds-ink1 border-ds-ink2'
                  : up   ? 'text-emerald-300 border-emerald-300/70'
                         : 'text-rose-300 border-rose-300/70';

  return (
    <div
      className="min-h-screen bg-ds-bg0 text-ds-ink0"
      style={{
        ['--hr-c' as never]: META.hr.colorFallback,
        ['--rhr-c' as never]: META.rhr.colorFallback,
        ['--hrv-c' as never]: META.hrv.colorFallback,
        ['--rr-c' as never]: META.rr.colorFallback,
        ['--sleep-c' as never]: META.sleep.colorFallback,
        ['--spo2-c' as never]: META.spo2.colorFallback,
        ['--temp-c' as never]: META.temp.colorFallback,
        ['--stress-c' as never]: META.stress.colorFallback,
        ['--steps-c' as never]: META.steps.colorFallback,
        ['--ppg-c' as never]: META.ppg.colorFallback,
      }}
    >
      {/* Top bar — sticky pra back sempre acessível. safe-area-top empurra
          o conteúdo pra baixo do notch/status bar iOS senão back fica clipado. */}
      <header className="sticky top-0 z-10 bg-ds-bg0/95 backdrop-blur-sm border-b border-white/[0.08] px-4 py-3 flex items-center gap-3 safe-area-top">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center justify-center w-10 h-10 rounded-full border border-white/[0.15] text-ds-ink1 hover:text-ds-ink0 hover:border-white/[0.3] transition-colors"
          aria-label="Voltar"
        >
          <ChevronLeft size={18} strokeWidth={2} />
        </button>
        <div className="flex-1 flex items-center gap-2.5">
          <span className="flex items-center justify-center w-9 h-9 rounded-[10px] bg-ds-bg2 border border-white/[0.08]" style={{ color: colorCss }}>
            <meta.Icon size={17} strokeWidth={1.6} />
          </span>
          <div>
            <div className="font-mono text-[9px] tracking-widest uppercase text-ds-ink2">Biomarcador</div>
            <div className="text-[17px] font-light tracking-tight text-ds-ink0 leading-tight" style={{ fontFamily: '"Inter Tight", Inter, sans-serif' }}>
              {meta.label}
            </div>
          </div>
        </div>
      </header>

      {/* Conteúdo — pb generoso pra home indicator iOS não cortar último card */}
      <div className="px-4 pt-5 pb-32 max-w-[640px] mx-auto safe-area-bottom">
        {/* Hero value */}
        <div className="mb-5">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-mono text-[64px] font-medium leading-none tracking-[-0.03em] text-ds-ink0" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {fmt(currentValue, meta.decimals)}
            </span>
            {meta.unit && <span className="font-mono text-[20px] text-ds-ink1">{meta.unit}</span>}
            {delta != null && (
              <span className={`ml-auto inline-flex items-center gap-1.5 font-mono text-[12px] font-medium tracking-wide1 uppercase px-2.5 py-1 border rounded-full ${deltaColor}`}>
                <TrendIcon size={12} strokeWidth={2.4} />
                {delta > 0 ? '+' : ''}{fmt(delta, meta.decimals)} {meta.unit}
              </span>
            )}
          </div>
          {deltaPct != null && (
            <div className="font-mono text-[11px] tracking-wider uppercase text-ds-ink1 mt-2">
              {DELTA_LABEL[range]} · {deltaPct > 0 ? '+' : ''}{deltaPct}%
            </div>
          )}
        </div>

        {/* Range tabs */}
        <div className="p-[3px] bg-ds-bg2 border border-white/[0.08] rounded-full grid grid-cols-3 mb-5">
          {RANGE_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setRange(t.key)}
              className={`font-mono text-[11px] tracking-widest uppercase py-2.5 rounded-full transition-colors ${
                range === t.key
                  ? 'bg-ds-bg1 text-ds-ink0'
                  : 'text-ds-ink1 hover:text-ds-ink0'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Chart card */}
        <div className="bg-ds-bg2 border border-white/[0.08] rounded-2xl p-4 pb-3 min-h-[280px] mb-5">
          {loading && (
            <div className="font-mono text-[11px] uppercase tracking-widest text-ds-ink1 py-24 text-center">
              Carregando série…
            </div>
          )}
          {!loading && (!series || series.every((p) => p.value === 0)) && (
            <div className="font-mono text-[11px] uppercase tracking-widest text-ds-ink1 py-24 text-center">
              Sem dados nessa janela
            </div>
          )}
          {!loading && series && series.some((p) => p.value !== 0) && (
            <DetailChart
              series={series}
              typical={meta.typical}
              physio={meta.physiological}
              decimals={meta.decimals}
              chartType={query.chartType}
              colorCss={colorCss}
            />
          )}
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { label: 'Mín', val: stats.min },
              { label: 'Média', val: stats.avg },
              { label: 'Máx', val: stats.max },
            ].map((s) => (
              <div key={s.label} className="bg-ds-bg2 border border-white/[0.08] rounded-xl p-3.5 text-center">
                <div className="font-mono text-[10px] tracking-widest uppercase text-ds-ink1 mb-2">{s.label}</div>
                <div className="font-mono text-[22px] font-medium tracking-tight text-ds-ink0" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(s.val, meta.decimals)}<span className="text-[13px] text-ds-ink1 ml-1">{meta.unit}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Faixas */}
        <div className="bg-ds-bg2 border border-white/[0.08] rounded-xl p-4 flex flex-col gap-2.5 mb-5">
          <div className="flex items-center justify-between font-mono uppercase">
            <span className="text-[11px] tracking-wide1 text-ds-ink1">Faixa típica (você)</span>
            <span className="text-[12px] font-medium tracking-wide1 text-ds-ink0" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {fmt(meta.typical[0], meta.decimals)}–{fmt(meta.typical[1], meta.decimals)} {meta.unit}
            </span>
          </div>
          <div className="flex items-center justify-between font-mono uppercase">
            <span className="text-[11px] tracking-wide1 text-ds-ink1">Faixa fisiológica</span>
            <span className="text-[12px] font-medium tracking-wide1 text-ds-ink0" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {fmt(meta.physiological[0], meta.decimals)}–{fmt(meta.physiological[1], meta.decimals)} {meta.unit}
            </span>
          </div>
          <div className="font-mono text-[11px] tracking-wide1 uppercase text-ds-ink1 pt-2 border-t border-white/[0.08]">
            Fonte · {ringLabel}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   DetailChart — SVG inline (line ou bar) com banda da faixa típica
   Reaproveitado do drawer original.
   ============================================================ */
type ChartProps = {
  series: { value: number; label: string }[];
  typical: [number, number];
  physio: [number, number];
  decimals: number;
  chartType: 'line' | 'bar';
  colorCss: string;
};

function DetailChart({ series, typical, physio, decimals, chartType, colorCss }: ChartProps) {
  const W = 380, H = 220, PAD_L = 36, PAD_R = 8, PAD_T = 14, PAD_B = 22;
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

  const bandTop = yScale(Math.min(typical[1], yMax));
  const bandBot = yScale(Math.max(typical[0], yMin));

  const yT0 = yMin, yT1 = (yMin + yMax) / 2, yT2 = yMax;

  const xTickIdx: number[] = [];
  if (n > 1) {
    const step = Math.max(1, Math.floor(n / 5));
    for (let i = 0; i < n; i += step) xTickIdx.push(i);
    if (xTickIdx[xTickIdx.length - 1] !== n - 1) xTickIdx.push(n - 1);
  }

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[220px] block" style={{ color: colorCss }} preserveAspectRatio="none">
        {[0, 1, 2, 3, 4].map((i) => (
          <line key={i} x1={PAD_L} y1={PAD_T + (innerH * i / 4)} x2={W - PAD_R} y2={PAD_T + (innerH * i / 4)}
                stroke="rgba(255,255,255,0.08)" strokeWidth={1} strokeDasharray="2 4" />
        ))}
        <text x={4} y={PAD_T + 4} className="font-mono" fontSize={10} fill="rgba(255,255,255,0.55)">{fmt(yT2, decimals)}</text>
        <text x={4} y={PAD_T + innerH / 2 + 3} className="font-mono" fontSize={10} fill="rgba(255,255,255,0.55)">{fmt(yT1, decimals)}</text>
        <text x={4} y={PAD_T + innerH + 2} className="font-mono" fontSize={10} fill="rgba(255,255,255,0.55)">{fmt(yT0, decimals)}</text>

        <rect x={PAD_L} y={Math.min(bandTop, bandBot)} width={innerW} height={Math.abs(bandBot - bandTop)}
              fill="currentColor" opacity={0.10} rx={3} />

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
            return (
              <>
                <path d={dArea} fill="currentColor" opacity={0.18} />
                <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                {series.map((p, i) => {
                  const isLast = i === n - 1;
                  if (!isLast && i % Math.max(1, Math.floor(n / 6)) !== 0) return null;
                  const x = PAD_L + i * xStep;
                  const y = yScale(p.value);
                  return isLast
                    ? <circle key={i} cx={x} cy={y} r={4.5} fill="currentColor" stroke="#e5e7eb" strokeWidth={1.5} />
                    : <circle key={i} cx={x} cy={y} r={3} fill="#0f1116" stroke="currentColor" strokeWidth={2} />;
                })}
              </>
            );
          })()
        )}
      </svg>
      <div className="flex justify-between mt-2 px-1 font-mono text-[10px] tracking-wide1 uppercase text-ds-ink1">
        {xTickIdx.map((i) => <span key={i}>{series[i]?.label ?? ''}</span>)}
      </div>
    </>
  );
}
