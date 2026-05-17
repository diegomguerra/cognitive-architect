import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Heart, Activity, Moon, Droplets, Thermometer, Brain, Zap, Footprints, Waves, HeartPulse, ChevronRight, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

type IconType = typeof Heart;

type DailyPoint = { dayKey: string; value: number };

type BiomarkerCard = {
  key: string;
  label: string;
  Icon: IconType;
  value: string;          // formatted main value (e.g. "72")
  rawNum: number | null;
  unit: string;
  detail?: string;
  qualityNote?: string;
  isStale: boolean;
  lastTimestamp?: string;
  // V2 fields
  series7d: DailyPoint[];          // up to 7 daily points (oldest → newest)
  typical: [number, number];       // user-typical band
  decimals: number;
  /** Optional secondary metric shown beside the main value (ex: Sono → Eficiência) */
  secondary?: { value: number; unit: string; label: string };
  /** Optional extra context line below the meta (ex: "REM 1.5h · Leve 4.2h · Profundo 1.2h") */
  contextLine?: string;
  /** Mini-chart style: 'line' (default) or 'bar' */
  chartType?: 'line' | 'bar';
  /** Source label (e.g. "JStyle X5", "derivado · HR p10") */
  sourceLabel?: string;
};

type SleepBreakdown = { totalHours: number; rem?: number; light?: number; deep?: number };
type SampleRow = { value: number | null; payload_json: unknown; ts: string; end_ts?: string | null };

const RING_SOURCES = ['parse_vendor_raw', 'qring_ble', 'jstyle', 'ring_daily_backfill'];

/** "14/05 22:46" — data + hora absoluta, pt-BR. */
function formatLastTs(latestIso: string | null): string | undefined {
  if (!latestIso) return undefined;
  const d = new Date(latestIso);
  if (isNaN(d.getTime())) return undefined;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** "16/05" — apenas data. */
function formatDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/** YYYY-MM-DD na timezone local. */
function localDayKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Gera lista YYYY-MM-DD dos últimos N dias (mais antigo → hoje), na TZ local. */
function lastNDays(n: number, anchorIso?: string): string[] {
  const base = anchorIso ? new Date(anchorIso) : new Date();
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    out.push(localDayKey(d.toISOString()));
  }
  return out;
}

/**
 * Agrupa samples por dia local e aplica reducer.
 * Retorna série de 7 pontos (dias sem dados ficam ausentes).
 */
function buildDailySeries(
  rows: SampleRow[],
  reducer: 'mean' | 'last' | 'max' | 'count',
  validRange: [number, number] | undefined,
  anchorIso: string,
): DailyPoint[] {
  const days = lastNDays(7, anchorIso);
  const byDay = new Map<string, number[]>();
  for (const r of rows) {
    const v = Number(r.value);
    if (!Number.isFinite(v)) continue;
    if (validRange && (v < validRange[0] || v > validRange[1])) continue;
    const k = localDayKey(r.ts);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(v);
  }
  const out: DailyPoint[] = [];
  for (const dayKey of days) {
    const vals = byDay.get(dayKey);
    if (!vals || vals.length === 0) continue;
    let val: number;
    if (reducer === 'mean') val = vals.reduce((a, b) => a + b, 0) / vals.length;
    else if (reducer === 'last') val = vals[0]; // rows pré-ordenados desc
    else if (reducer === 'max') val = Math.max(...vals);
    else val = vals.length;
    out.push({ dayKey, value: Math.round(val * 10) / 10 });
  }
  return out;
}

/** Faixas típicas hardcoded por métrica (poderia vir do score engine no futuro). */
const TYPICAL_BANDS: Record<string, [number, number]> = {
  hr: [58, 88],
  rhr: [52, 62],
  hrv: [35, 70],
  rr: [780, 950],
  sleep: [7, 9],
  spo2: [95, 99],
  temp: [36, 36.8],
  stress: [20, 50],
  steps: [6000, 12000],
  ppg: [10000, 25000],
};

/* ============================================================
   Mini sparkline 7d inline (SVG)
   ============================================================ */
type SparkProps = { series: DailyPoint[]; typical: [number, number]; type: 'line' | 'bar'; colorVar: string };
function MiniSparkline({ series, typical, type, colorVar }: SparkProps) {
  if (series.length === 0) {
    return (
      <div className="flex items-center justify-center w-[148px] h-[58px] font-mono text-[10px] text-ds-ink2 uppercase tracking-wide1">
        sem 7d
      </div>
    );
  }
  const W = 148, H = 58, PAD = 4;
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;
  const vals = series.map((p) => p.value);
  const dataMin = Math.min(...vals);
  const dataMax = Math.max(...vals);
  const padY = (dataMax - dataMin) * 0.2 || Math.max(1, Math.abs(dataMax) * 0.1);
  const yMin = dataMin - padY;
  const yMax = dataMax + padY;
  const yScale = (v: number) => PAD + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;

  const bandTop = yScale(Math.min(typical[1], yMax));
  const bandBot = yScale(Math.max(typical[0], yMin));

  if (type === 'bar') {
    const n = series.length;
    const barW = innerW / n - 2;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" style={{ color: `var(${colorVar})` }}>
        <rect x={PAD} y={Math.min(bandTop, bandBot)} width={innerW} height={Math.abs(bandBot - bandTop)} fill="currentColor" opacity={0.10} rx={2} />
        {series.map((p, i) => {
          const x = PAD + i * (innerW / n) + 1;
          const y = yScale(p.value);
          const h = (PAD + innerH) - y;
          const today = i === n - 1;
          return <rect key={p.dayKey} x={x} y={y} width={barW} height={Math.max(0, h)} fill="currentColor" opacity={today ? 1 : 0.55} rx={1.5} />;
        })}
      </svg>
    );
  }
  const n = series.length;
  const xStep = n > 1 ? innerW / (n - 1) : 0;
  let d = '';
  let dArea = '';
  series.forEach((p, i) => {
    const x = PAD + i * xStep;
    const y = yScale(p.value);
    if (i === 0) { d += `M ${x} ${y}`; dArea += `M ${x} ${PAD + innerH} L ${x} ${y}`; }
    else { d += ` L ${x} ${y}`; dArea += ` L ${x} ${y}`; }
  });
  dArea += ` L ${PAD + (n - 1) * xStep} ${PAD + innerH} Z`;
  const lastX = PAD + (n - 1) * xStep;
  const lastY = yScale(series[n - 1].value);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" style={{ color: `var(${colorVar})` }}>
      <rect x={PAD} y={Math.min(bandTop, bandBot)} width={innerW} height={Math.abs(bandBot - bandTop)} fill="currentColor" opacity={0.10} rx={2} />
      <path d={dArea} fill="currentColor" opacity={0.20} />
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={3.5} fill="currentColor" stroke="#0f1116" strokeWidth={1.5} />
    </svg>
  );
}

/* ============================================================
   Cor de acento por métrica (CSS custom prop -- usa palette VYR)
   ============================================================ */
const COLOR_VAR: Record<string, string> = {
  hr: '--hr-c', rhr: '--rhr-c', hrv: '--hrv-c', rr: '--rr-c', sleep: '--sleep-c',
  spo2: '--spo2-c', temp: '--temp-c', stress: '--stress-c', steps: '--steps-c', ppg: '--ppg-c',
};

const FALLBACK_COLORS: Record<string, string> = {
  hr: 'hsl(340 70% 70%)',
  rhr: 'hsl(340 70% 60%)',
  hrv: 'hsl(265 65% 75%)',
  rr: 'hsl(195 55% 70%)',
  sleep: 'hsl(240 60% 70%)',
  spo2: 'hsl(190 70% 70%)',
  temp: 'hsl(20 80% 65%)',
  stress: 'hsl(42 80% 65%)',
  steps: 'hsl(40 80% 60%)',
  ppg: 'hsl(50 90% 60%)',
};

/* ============================================================
   Formatação numérica
   ============================================================ */
function fmt(v: number | null | undefined, decimals = 0): string {
  if (v == null || isNaN(v)) return '—';
  if (Math.abs(v) >= 1000) return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  return decimals > 0 ? v.toFixed(decimals).replace('.', ',') : Math.round(v).toString();
}

/* ============================================================
   Componente principal
   ============================================================ */
export function BiomarkersGrid() {
  const [cards, setCards] = useState<BiomarkerCard[]>([]);
  const [anchorDay, setAnchorDay] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

        // Lookup do device pareado do usuário pra montar sourceLabel correto.
        // Cada card mostra o anel real ("Colmi R09" pra Lídia/Daniele; "JStyle X5" pra Diego).
        const { data: devRows } = await supabase
          .from('devices')
          .select('vendor, model')
          .eq('user_id', user.id)
          .order('last_seen_at', { ascending: false })
          .limit(1);
        const dev = devRows?.[0];
        const ringLabel = dev
          ? `${dev.vendor === 'colmi' ? 'Colmi' : dev.vendor === 'jstyle' ? 'JStyle' : dev.vendor} ${dev.model ?? ''}`.trim()
          : 'Anel';

        // Build 413: filtra samples com ts futuro (parser bug pode gerar até
        // 32 dias à frente). Limite +1 dia pra cobrir diferenças timezone.
        const nowPlus1d = new Date(Date.now() + 86400_000).toISOString();
        const fetchType = async (types: string[], lim = 500) => {
          const { data } = await supabase
            .from('biomarker_samples')
            .select('value, payload_json, ts, end_ts')
            .eq('user_id', user.id)
            .in('type', types)
            .in('source', RING_SOURCES)
            .gte('ts', since)
            .lte('ts', nowPlus1d)
            .order('ts', { ascending: false })
            .limit(lim);
          return (data ?? []) as SampleRow[];
        };

        const [hrRows, hrvRows, sleepRows, spo2Rows, tempRows, stressRows, rrRows, rhrRows, stepsRows, ppgRows] = await Promise.all([
          fetchType(['hr', 'heart_rate']),
          fetchType(['hrv', 'hrv_rmssd', 'rmssd']),
          fetchType(['sleep'], 1000),
          fetchType(['spo2', 'oxygen_saturation']),
          fetchType(['temp', 'body_temp', 'skin_temp']),
          fetchType(['stress', 'stress_level']),
          fetchType(['rr_interval']),
          fetchType(['rhr']),
          fetchType(['steps']),
          fetchType(['ppg'], 1000),
        ]);

        // Build 413: Colmi não emite PPG 24-bit raw, mas anel R09 emite stream
        // realtime ECG/PPG via cmd 0x69. Contamos esses packets em debug_raw
        // como equivalente do "PPG samples" pra ter o card popular pra Colmi.
        let colmiSignalCount = 0;
        let colmiSignalLabel: string | undefined;
        if (dev?.vendor === 'colmi') {
          const { count } = await supabase
            .from('biomarker_samples')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('type', 'debug_raw')
            .eq('source', 'qring_ble')
            .gte('ts', since)
            .lte('ts', nowPlus1d)
            .ilike('payload_json->>raw', '69 %');
          colmiSignalCount = count ?? 0;
          colmiSignalLabel = '7d · ECG/PPG stream';
        }

        // Anchor day = dia local da última leitura disponível em qualquer tipo.
        // Build 413: defensiva extra contra ts futuro (mesmo se fetchType já filtra).
        const nowMs = Date.now() + 86400_000;
        const allRowGroups = [hrRows, hrvRows, sleepRows, spo2Rows, tempRows, stressRows, rrRows, rhrRows, stepsRows];
        const maxTsIso = allRowGroups
          .map((rs) => rs[0]?.ts)
          .filter((t): t is string => !!t && new Date(t).getTime() <= nowMs)
          .reduce<string | null>((a, b) => (a == null || b > a ? b : a), null);
        const anchorDayKey = maxTsIso ? localDayKey(maxTsIso) : localDayKey(new Date().toISOString());
        const anchorIsoDay = `${anchorDayKey}T00:00:00`;

        const inAnchorDay = (rows: SampleRow[]) => rows.filter((r) => localDayKey(r.ts) === anchorDayKey);
        const numValues = (rows: SampleRow[]) =>
          rows.map((r) => Number(r.value)).filter((v) => Number.isFinite(v));
        const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
        const lastTs = (rows: SampleRow[]) => rows[0]?.ts ?? null;

        type Agg = { value: number | null; n: number; ts: string | null; isStale: boolean };
        const aggregate = (
          rows: SampleRow[],
          reducer: (vals: number[]) => number | null,
          validRange?: [number, number],
        ): Agg => {
          const filter = (rs: SampleRow[]) =>
            rs.map((r) => Number(r.value)).filter((v) => Number.isFinite(v))
              .filter((v) => !validRange || (v >= validRange[0] && v <= validRange[1]));
          const dayRows = inAnchorDay(rows);
          const dayVals = filter(dayRows);
          if (dayVals.length > 0) return { value: reducer(dayVals), n: dayVals.length, ts: lastTs(dayRows), isStale: false };
          const allVals = filter(rows);
          if (allVals.length === 0) return { value: null, n: 0, ts: null, isStale: true };
          return { value: reducer(allVals), n: allVals.length, ts: lastTs(rows), isStale: true };
        };

        // ---- Sleep breakdown (mesma regra anterior: noite que terminou no anchor) ----
        const sleepBreak = (() => {
          const [ay, am, ad] = anchorDayKey.split('-').map((v) => parseInt(v, 10));
          const sleepWindowStart = new Date(ay, am - 1, ad - 1, 18, 0, 0, 0).getTime();
          const sleepWindowEnd = new Date(ay, am - 1, ad, 12, 0, 0, 0).getTime();
          const inSleepWindow = (rows: SampleRow[]) => rows.filter((r) => {
            const t = new Date(r.ts).getTime();
            return t >= sleepWindowStart && t < sleepWindowEnd;
          });

          let rowsToUse = inSleepWindow(sleepRows);
          let isStale = false;
          if (rowsToUse.length === 0 && sleepRows.length > 0) {
            const nightKeyOf = (iso: string): string => {
              const d = new Date(iso);
              const hour = d.getHours();
              const dt = new Date(d);
              if (hour >= 12) dt.setDate(dt.getDate() + 1);
              return localDayKey(dt.toISOString());
            };
            const mostRecentNight = nightKeyOf(sleepRows[0].ts);
            rowsToUse = sleepRows.filter((r) => nightKeyOf(r.ts) === mostRecentNight);
            isStale = true;
          }
          if (rowsToUse.length === 0) return null;
          // Dedup minuto-a-minuto: parse-vendor-raw emite múltiplos records (vindos
          // de packets de paginação que se sobrepõem temporalmente) cobrindo o mesmo
          // intervalo da noite. Somar duration_min ingenuamente gera 38h+ por noite.
          // Constrói timeline: cada minuto recebe um único stage (primeiro que chega).
          const minuteStage = new Map<number, string>();
          for (const r of rowsToUse) {
            const stage = (((r.payload_json as Record<string, unknown>)?.stage ?? '') as string).toLowerCase();
            if (!stage) continue;
            const startMs = new Date(r.ts).getTime();
            const dur = Number((r.payload_json as Record<string, unknown>)?.duration_min ?? 1);
            const minuteCount = Math.max(1, Math.round(dur));
            const startMinute = Math.floor(startMs / 60_000);
            for (let m = 0; m < minuteCount; m++) {
              const key = startMinute + m;
              if (!minuteStage.has(key)) minuteStage.set(key, stage);
            }
          }
          let totalMin = 0, rem = 0, light = 0, deep = 0;
          for (const stage of minuteStage.values()) {
            totalMin += 1;
            if (stage.includes('rem')) rem += 1;
            else if (stage.includes('deep') || stage.includes('profundo')) deep += 1;
            else if (stage.includes('light') || stage.includes('leve')) light += 1;
          }
          const out: SleepBreakdown = { totalHours: Math.round((totalMin / 60) * 10) / 10 };
          if (rem || light || deep) {
            out.rem = Math.round((rem / 60) * 10) / 10;
            out.light = Math.round((light / 60) * 10) / 10;
            out.deep = Math.round((deep / 60) * 10) / 10;
          }
          // eficiência: total/(total+awake) — sem dado de awake usamos heurística simples
          const efficiency = totalMin > 0 ? Math.round((totalMin / Math.max(totalMin, totalMin + 30)) * 100) : null;
          return { ...out, isStale, efficiency };
        })();

        // ---- Aggregations ponto-do-dia ----
        const hr = aggregate(hrRows, (xs) => mean(xs), [30, 220]);
        const hrv = aggregate(hrvRows, (xs) => xs[0] ?? null, [5, 250]);
        const spo2 = aggregate(spo2Rows, (xs) => mean(xs), [70, 100]);
        const rr = aggregate(rrRows, (xs) => mean(xs), [200, 2000]);
        const temp = aggregate(tempRows, (xs) => xs[0] ?? null, [25, 42]);
        const stress = aggregate(stressRows, (xs) => xs[0] ?? null, [0, 100]);
        const stepsAgg = aggregate(stepsRows, (xs) => Math.max(...xs));

        const rhr = (() => {
          const direct = aggregate(rhrRows, (xs) => mean(xs), [30, 100]);
          if (direct.value != null) return { ...direct, derived: false };
          const hrVals = numValues(inAnchorDay(hrRows)).filter((v) => v >= 30 && v <= 220);
          if (hrVals.length >= 5) {
            const sorted = [...hrVals].sort((a, b) => a - b);
            const p10idx = Math.max(0, Math.floor(sorted.length * 0.1) - 1);
            return { value: sorted[p10idx], n: hrVals.length, ts: lastTs(inAnchorDay(hrRows)), isStale: false, derived: true };
          }
          const allHr = numValues(hrRows).filter((v) => v >= 30 && v <= 220);
          if (allHr.length >= 5) {
            const sorted = [...allHr].sort((a, b) => a - b);
            const p10idx = Math.max(0, Math.floor(sorted.length * 0.1) - 1);
            return { value: sorted[p10idx], n: allHr.length, ts: lastTs(hrRows), isStale: true, derived: true };
          }
          return { ...direct, derived: false };
        })();

        const stressFinal = (() => {
          if (stress.value != null) return { ...stress, derived: false };
          if (hrv.value != null) {
            const v = Math.max(0, Math.min(100, 100 - hrv.value * 1.2));
            return { value: v, n: hrv.n, ts: hrv.ts, isStale: hrv.isStale, derived: true };
          }
          return { ...stress, derived: false };
        })();

        // ---- Séries 7d ----
        const series = {
          hr: buildDailySeries(hrRows, 'mean', [30, 220], anchorIsoDay),
          rhr: buildDailySeries(rhrRows.length ? rhrRows : hrRows, rhrRows.length ? 'mean' : 'mean', [30, 220], anchorIsoDay),
          hrv: buildDailySeries(hrvRows, 'mean', [5, 250], anchorIsoDay),
          rr: buildDailySeries(rrRows, 'mean', [200, 2000], anchorIsoDay),
          sleep: buildDailySeries(sleepRows, 'count', undefined, anchorIsoDay), // contagem de minutos
          spo2: buildDailySeries(spo2Rows, 'mean', [70, 100], anchorIsoDay),
          temp: buildDailySeries(tempRows, 'mean', [25, 42], anchorIsoDay),
          stress: buildDailySeries(stressRows.length ? stressRows : hrvRows, 'mean', [0, 250], anchorIsoDay),
          steps: buildDailySeries(stepsRows, 'max', undefined, anchorIsoDay),
          ppg: buildDailySeries(ppgRows, 'count', undefined, anchorIsoDay),
        };

        // Converter série de sono (count de minutos) em horas
        series.sleep = series.sleep.map((p) => ({ ...p, value: Math.round((p.value / 60) * 10) / 10 }));

        const out: BiomarkerCard[] = [
          {
            key: 'hr', label: 'Freq. Cardíaca', Icon: Heart, decimals: 0,
            value: hr.value != null ? `${Math.round(hr.value)}` : '—',
            rawNum: hr.value, unit: 'bpm',
            detail: hr.value != null ? `média · n=${hr.n}` : undefined,
            isStale: hr.isStale, lastTimestamp: formatLastTs(hr.ts),
            series7d: series.hr, typical: TYPICAL_BANDS.hr,
            chartType: 'line', sourceLabel: ringLabel,
          },
          {
            key: 'rhr', label: 'FC de Repouso', Icon: HeartPulse, decimals: 0,
            value: rhr.value != null ? `${Math.round(rhr.value)}` : '—',
            rawNum: rhr.value, unit: 'bpm',
            detail: rhr.derived ? `derivado p10 · n=${rhr.n}` : rhr.value != null ? `direto · n=${rhr.n}` : undefined,
            isStale: rhr.isStale, lastTimestamp: formatLastTs(rhr.ts),
            series7d: series.rhr, typical: TYPICAL_BANDS.rhr,
            chartType: 'line', sourceLabel: rhr.derived ? 'derivado · HR p10' : ringLabel,
          },
          {
            key: 'hrv', label: 'HRV (RMSSD)', Icon: Activity, decimals: 0,
            value: hrv.value != null ? `${Math.round(hrv.value)}` : '—',
            rawNum: hrv.value, unit: 'ms',
            detail: hrv.value != null ? `última leitura · n=${hrv.n}` : undefined,
            qualityNote: hrv.value == null ? 'Sem leitura válida' : undefined,
            isStale: hrv.isStale, lastTimestamp: formatLastTs(hrv.ts),
            series7d: series.hrv, typical: TYPICAL_BANDS.hrv,
            chartType: 'line', sourceLabel: ringLabel,
          },
          {
            key: 'rr', label: 'Intervalos RR', Icon: Waves, decimals: 0,
            value: rr.value != null ? `${Math.round(rr.value)}` : '—',
            rawNum: rr.value, unit: 'ms',
            detail: rr.value != null ? `média · n=${rr.n}` : undefined,
            isStale: rr.isStale, lastTimestamp: formatLastTs(rr.ts),
            series7d: series.rr, typical: TYPICAL_BANDS.rr,
            chartType: 'line', sourceLabel: ringLabel,
          },
          {
            key: 'sleep', label: 'Sono', Icon: Moon, decimals: 1,
            value: sleepBreak && sleepBreak.totalHours > 0 ? `${sleepBreak.totalHours.toFixed(1).replace('.', ',')}` : '—',
            rawNum: sleepBreak?.totalHours ?? null, unit: 'h',
            detail: undefined,
            contextLine: sleepBreak ? [
              (sleepBreak.rem ?? 0) > 0 ? `REM ${sleepBreak.rem}h` : null,
              `Leve ${sleepBreak.light ?? 0}h`,
              `Prof ${sleepBreak.deep ?? 0}h`,
            ].filter(Boolean).join(' · ') : undefined,
            secondary: sleepBreak && sleepBreak.efficiency != null
              ? { value: sleepBreak.efficiency, unit: '%', label: 'Eficiência' }
              : undefined,
            qualityNote: !sleepBreak ? 'Sem registro 7d' : undefined,
            isStale: sleepBreak?.isStale ?? true,
            lastTimestamp: formatLastTs(lastTs(sleepRows)),
            series7d: series.sleep, typical: TYPICAL_BANDS.sleep,
            chartType: 'bar', sourceLabel: ringLabel,
          },
          {
            key: 'spo2', label: 'SpO₂', Icon: Droplets, decimals: 0,
            value: spo2.value != null ? `${Math.round(spo2.value)}` : '—',
            rawNum: spo2.value, unit: '%',
            detail: spo2.value != null ? `média · n=${spo2.n}` : undefined,
            isStale: spo2.isStale, lastTimestamp: formatLastTs(spo2.ts),
            series7d: series.spo2, typical: TYPICAL_BANDS.spo2,
            chartType: 'line', sourceLabel: ringLabel,
          },
          {
            key: 'temp', label: 'Temperatura', Icon: Thermometer, decimals: 1,
            value: temp.value != null ? `${temp.value.toFixed(1).replace('.', ',')}` : '—',
            rawNum: temp.value, unit: '°C',
            detail: temp.value != null ? `pele · n=${temp.n}` : undefined,
            isStale: temp.isStale, lastTimestamp: formatLastTs(temp.ts),
            series7d: series.temp, typical: TYPICAL_BANDS.temp,
            chartType: 'line', sourceLabel: 'pele',
          },
          {
            key: 'stress', label: 'Estresse', Icon: Brain, decimals: 0,
            value: stressFinal.value != null ? `${Math.round(stressFinal.value)}` : '—',
            rawNum: stressFinal.value, unit: '',
            detail: stressFinal.derived ? `derivado de HRV ${Math.round(hrv.value ?? 0)}ms` : stressFinal.value != null ? `n=${stressFinal.n}` : undefined,
            isStale: stressFinal.isStale, lastTimestamp: formatLastTs(stressFinal.ts),
            series7d: series.stress, typical: TYPICAL_BANDS.stress,
            chartType: 'line', sourceLabel: stressFinal.derived ? 'derivado · HRV' : ringLabel,
          },
          {
            key: 'steps', label: 'Passos', Icon: Footprints, decimals: 0,
            value: stepsAgg.value != null ? `${stepsAgg.value.toLocaleString('pt-BR')}` : '—',
            rawNum: stepsAgg.value, unit: '',
            detail: stepsAgg.value != null ? `máx do dia · n=${stepsAgg.n}` : undefined,
            isStale: stepsAgg.isStale, lastTimestamp: formatLastTs(stepsAgg.ts),
            series7d: series.steps, typical: TYPICAL_BANDS.steps,
            chartType: 'bar', sourceLabel: ringLabel,
          },
          {
            // Build 413: card "PPG (raw)" pra JStyle = type='ppg' samples (24-bit ADC).
            // Pra Colmi = contagem de packets cmd 0x69 (ECG/PPG stream realtime).
            key: 'ppg', label: 'Sinal raw', Icon: Zap, decimals: 0,
            value: dev?.vendor === 'colmi'
              ? (colmiSignalCount ? colmiSignalCount.toLocaleString('pt-BR') : '—')
              : (ppgRows.length ? ppgRows.length.toLocaleString('pt-BR') : '—'),
            rawNum: dev?.vendor === 'colmi'
              ? (colmiSignalCount || null)
              : (ppgRows.length || null),
            unit: 'amostras',
            detail: dev?.vendor === 'colmi'
              ? (colmiSignalCount ? colmiSignalLabel : undefined)
              : (ppgRows.length ? '7d · 24-bit ADC' : undefined),
            isStale: false,
            series7d: series.ppg, typical: TYPICAL_BANDS.ppg,
            chartType: 'bar', sourceLabel: '24-bit ADC',
          },
        ];

        if (!cancelled) {
          setCards(out);
          setAnchorDay(anchorIsoDay);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const filledCount = useMemo(() => cards.filter((c) => c.rawNum != null && !c.isStale).length, [cards]);
  const totalCount = cards.length;

  if (loading) {
    return <div className="font-mono text-[12px] tracking-wide2 text-ds-ink1 uppercase py-6 px-1">Carregando biomarcadores…</div>;
  }

  return (
    <section className="px-1 mt-8" style={{
      // CSS custom props com as cores por métrica — referenciadas pelos sparklines
      ['--hr-c' as never]: FALLBACK_COLORS.hr,
      ['--rhr-c' as never]: FALLBACK_COLORS.rhr,
      ['--hrv-c' as never]: FALLBACK_COLORS.hrv,
      ['--rr-c' as never]: FALLBACK_COLORS.rr,
      ['--sleep-c' as never]: FALLBACK_COLORS.sleep,
      ['--spo2-c' as never]: FALLBACK_COLORS.spo2,
      ['--temp-c' as never]: FALLBACK_COLORS.temp,
      ['--stress-c' as never]: FALLBACK_COLORS.stress,
      ['--steps-c' as never]: FALLBACK_COLORS.steps,
      ['--ppg-c' as never]: FALLBACK_COLORS.ppg,
    }}>
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="text-[26px] font-light tracking-[-0.01em] text-ds-ink0"
            style={{ fontFamily: '"Inter Tight", Inter, sans-serif' }}>
          Biomarcadores · {anchorDay ? formatDay(anchorDay) : ''}
        </h3>
        <span className="font-mono text-[13px] font-medium tracking-wide2 uppercase text-ds-ink1">
          {filledCount}/{totalCount} hoje
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {cards.map((c) => {
          const isNull = c.rawNum == null;
          const isDim = isNull;
          const colorVar = COLOR_VAR[c.key];
          const colorCss = `var(${colorVar})`;
          const vals = c.series7d.map((p) => p.value);
          const min = vals.length ? Math.min(...vals) : null;
          const max = vals.length ? Math.max(...vals) : null;
          const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
          const delta = (c.rawNum != null && avg != null) ? c.rawNum - avg : null;
          const deltaPct = (delta != null && avg) ? Math.round((delta / avg) * 100) : null;
          const flat = deltaPct != null && Math.abs(deltaPct) < 2;
          const up = !flat && delta != null && delta > 0;
          const TrendIcon = flat ? Minus : up ? TrendingUp : TrendingDown;
          const deltaColor = flat ? 'text-ds-ink1 border-ds-ink2' : up ? 'text-emerald-300 border-emerald-300/70' : 'text-rose-300 border-rose-300/70';

          return (
            <button
              key={c.key}
              type="button"
              onClick={() => navigate(`/biomarker/${c.key}`)}
              className={`relative bg-ds-bg2 border border-white/[0.08] rounded-[18px] p-5 text-left transition-colors hover:bg-ds-bg2/80 hover:border-white/[0.15] active:scale-[0.995] ${isDim ? 'opacity-70' : ''}`}
            >
              {/* faixa de acento à esquerda */}
              <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[4px] rounded-l-[18px] opacity-70" style={{ background: colorCss }} />

              {/* header */}
              <div className="flex items-center gap-3 mb-3">
                <span className="flex items-center justify-center w-[38px] h-[38px] rounded-[11px] bg-ds-bg0 border border-white/[0.08]" style={{ color: colorCss }}>
                  <c.Icon size={18} strokeWidth={1.6} />
                </span>
                <span className="flex-1 font-mono text-[14px] font-medium tracking-wide2 uppercase text-ds-ink0">
                  {c.label}
                </span>
                {c.isStale && !isNull && (
                  <span className="font-mono text-[11px] tracking-wide1 text-ds-ink1 uppercase whitespace-nowrap bg-ds-bg0 border border-white/[0.15] px-2.5 py-1 rounded-full">
                    anterior
                  </span>
                )}
                <ChevronRight size={20} className="text-ds-ink2 ml-1 flex-shrink-0" strokeWidth={1.8} />
              </div>

              {/* hero: valor + (eficiência) + sparkline */}
              <div className="grid grid-cols-[1fr_auto] gap-3.5 items-center mb-3.5">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className="font-mono text-[54px] font-medium leading-[0.95] tracking-[-0.03em] text-ds-ink0"
                          style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {c.value}
                    </span>
                    {!isNull && c.unit && (
                      <span className="font-mono text-[19px] text-ds-ink1">{c.unit}</span>
                    )}
                    {c.secondary && (
                      <>
                        <span className="inline-block w-px h-9 bg-white/[0.18] mx-2 self-center" aria-hidden />
                        <span className="inline-flex flex-col items-start">
                          <span className="font-mono text-[38px] font-medium leading-[0.95] tracking-[-0.02em] text-ds-ink0"
                                style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {c.secondary.value}
                            <span className="text-[17px] text-ds-ink1 ml-1 font-medium">{c.secondary.unit}</span>
                          </span>
                          <span className="font-mono text-[12px] font-medium tracking-wide2 uppercase text-ds-ink1 mt-1">
                            {c.secondary.label}
                          </span>
                        </span>
                      </>
                    )}
                  </div>
                  {delta != null && avg != null && (
                    <span className={`self-start inline-flex items-center gap-1.5 font-mono text-[13px] font-medium tracking-wide1 uppercase px-2.5 py-1 border rounded-full ${deltaColor}`}>
                      <TrendIcon size={12} strokeWidth={2.4} />
                      {delta > 0 ? '+' : ''}{fmt(delta, c.decimals)} {c.unit} · {delta > 0 ? '+' : ''}{deltaPct}%
                    </span>
                  )}
                </div>

                {/* sparkline + label explícito */}
                <div className="flex flex-col items-end gap-1">
                  <span className="font-mono text-[10px] font-medium tracking-wide2 uppercase text-ds-ink2 leading-tight text-right">
                    Últimos 7 dias<br />
                    <span className="text-ds-ink2 normal-case tracking-wide1">{c.chartType === 'bar' ? 'totais diários' : 'média diária'}</span>
                  </span>
                  <div className="w-[148px] h-[58px]">
                    <MiniSparkline series={c.series7d} typical={c.typical} type={c.chartType ?? 'line'} colorVar={colorVar} />
                  </div>
                </div>
              </div>

              {/* stats row */}
              {vals.length > 0 && (
                <div className="grid grid-cols-3 gap-2.5 py-3.5 border-t border-b border-white/[0.15]">
                  <div className="text-center">
                    <div className="font-mono text-[11px] font-medium tracking-wide2 uppercase text-ds-ink1 mb-1.5">Mín 7d</div>
                    <div className="font-mono text-[20px] font-medium text-ds-ink0 tracking-[-0.01em]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(min, c.decimals)}<span className="text-[13px] text-ds-ink1 ml-1">{c.unit}</span>
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="font-mono text-[11px] font-medium tracking-wide2 uppercase text-ds-ink1 mb-1.5">Média 7d</div>
                    <div className="font-mono text-[20px] font-medium text-ds-ink0 tracking-[-0.01em]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(avg, c.decimals)}<span className="text-[13px] text-ds-ink1 ml-1">{c.unit}</span>
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="font-mono text-[11px] font-medium tracking-wide2 uppercase text-ds-ink1 mb-1.5">Máx 7d</div>
                    <div className="font-mono text-[20px] font-medium text-ds-ink0 tracking-[-0.01em]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(max, c.decimals)}<span className="text-[13px] text-ds-ink1 ml-1">{c.unit}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* footer */}
              <div className="mt-3.5 flex flex-col gap-2">
                <div className="flex items-center justify-between font-mono uppercase">
                  <span className="text-[12px] tracking-wide1 text-ds-ink1">Faixa típica</span>
                  <span className="text-[13px] font-medium tracking-wide1 text-ds-ink0" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(c.typical[0], c.decimals)}–{fmt(c.typical[1], c.decimals)} {c.unit}
                  </span>
                </div>
                {(c.detail || c.lastTimestamp || c.sourceLabel) && (
                  <div className="font-mono text-[12px] tracking-wide1 uppercase text-ds-ink1 leading-tight">
                    {[c.detail, c.lastTimestamp ? `última ${c.lastTimestamp}` : null, c.sourceLabel].filter(Boolean).join(' · ')}
                  </div>
                )}
                {c.contextLine && (
                  <div className="font-mono text-[12px] tracking-wide1 uppercase text-ds-ink1">
                    {c.contextLine}
                  </div>
                )}
                {c.qualityNote && (
                  <div className="font-mono text-[12px] tracking-wide1 text-ds-ink1 italic normal-case">
                    {c.qualityNote}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
