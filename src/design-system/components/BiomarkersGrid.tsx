import { useEffect, useState } from 'react';
import { Heart, Activity, Moon, Droplets, Thermometer, Brain, Zap, Footprints, Waves, HeartPulse } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

type BiomarkerCard = {
  key: string;
  label: string;
  Icon: typeof Heart;
  value: string;
  rawNum: number | null;
  unit: string;
  qualityNote?: string;
  detail?: string;
  isStale: boolean;          // true when value comes from a day older than anchor
  lastTimestamp?: string;    // "14/05 22:46"
};

type SleepBreakdown = {
  totalHours: number;
  rem?: number;
  light?: number;
  deep?: number;
};

type SampleRow = { value: number | null; payload_json: unknown; ts: string; end_ts?: string | null };

const RING_SOURCES = ['parse_vendor_raw', 'qring_ble', 'jstyle', 'ring_daily_backfill'];

/** "14/05 22:46" — data + hora absoluta, formato pt-BR. */
function formatLastTs(latestIso: string | null): string | undefined {
  if (!latestIso) return undefined;
  const d = new Date(latestIso);
  if (isNaN(d.getTime())) return undefined;
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

/** "16/05" — apenas a data. */
function formatDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/**
 * Cards de 10 biomarcadores alinhados a um "dia âncora" = dia da última leitura
 * disponível em qualquer tipo. Cada card prefere mostrar valor do dia âncora;
 * se não houver dado naquele dia, faz fallback para a leitura mais recente
 * dos últimos 7d e marca o card como "anterior" (isStale=true).
 *
 * Regra Diego 2026-05-16: todos os cards devem refletir o mesmo dia. Quando
 * um tipo não tem dado no dia, o card mostra "Última: DD/MM HH:mm" abaixo
 * para o usuário saber a defasagem em vez de uma data implícita diferente.
 */
export function BiomarkersGrid() {
  const [cards, setCards] = useState<BiomarkerCard[]>([]);
  const [anchorDay, setAnchorDay] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

        const fetchType = async (types: string[], lim = 500) => {
          const { data } = await supabase
            .from('biomarker_samples')
            .select('value, payload_json, ts, end_ts')
            .eq('user_id', user.id)
            .in('type', types)
            .in('source', RING_SOURCES)
            .gte('ts', since)
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

        // ===== Anchor day: max(ts) across all biomarker fetches =====
        // Usa LOCAL date (do device) calculada via toLocaleDateString pra evitar
        // bugs de timezone na comparação UTC. Anchor day = dia local do último
        // sample disponível em qualquer tipo.
        const allRowGroups = [hrRows, hrvRows, sleepRows, spo2Rows, tempRows, stressRows, rrRows, rhrRows, stepsRows];
        const maxTsIso = allRowGroups
          .map((rs) => rs[0]?.ts)
          .filter((t): t is string => !!t)
          .reduce<string | null>((a, b) => (a == null || b > a ? b : a), null);

        // YYYY-MM-DD na timezone local do device.
        const localDayKey = (iso: string): string => {
          const d = new Date(iso);
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          return `${y}-${m}-${day}`;
        };
        const anchorDayKey = maxTsIso ? localDayKey(maxTsIso) : localDayKey(new Date().toISOString());
        const anchorIsoDay = `${anchorDayKey}T00:00:00`;

        const inAnchorDay = (rows: SampleRow[]) => rows.filter((r) => localDayKey(r.ts) === anchorDayKey);

        const numValues = (rows: SampleRow[]) =>
          rows.map((r) => Number(r.value)).filter((v) => Number.isFinite(v));

        const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
        const lastTs = (rows: SampleRow[]) => rows[0]?.ts ?? null;

        // Helper: returns aggregated value preferring anchor-day data.
        type Agg = { value: number | null; n: number; ts: string | null; isStale: boolean };
        const aggregate = (
          rows: SampleRow[],
          reducer: (vals: number[]) => number | null,
          validRange?: [number, number],
        ): Agg => {
          const filter = (rs: SampleRow[]) => {
            const vals = rs
              .map((r) => Number(r.value))
              .filter((v) => Number.isFinite(v))
              .filter((v) => !validRange || (v >= validRange[0] && v <= validRange[1]));
            return vals;
          };
          const dayRows = inAnchorDay(rows);
          const dayVals = filter(dayRows);
          if (dayVals.length > 0) {
            return { value: reducer(dayVals), n: dayVals.length, ts: lastTs(dayRows), isStale: false };
          }
          // Fallback: últimos 7d
          const allVals = filter(rows);
          if (allVals.length === 0) return { value: null, n: 0, ts: null, isStale: true };
          return { value: reducer(allVals), n: allVals.length, ts: lastTs(rows), isStale: true };
        };

        // Sleep breakdown (REM/Leve/Profundo a partir do payload.stage)
        //
        // Regra Diego 2026-05-16: "sleep do dia X" = noite que TERMINOU em X.
        // Janela = 18h LOCAL do dia anterior até 12h LOCAL do anchor day,
        // capturando dormida noturna típica (incluindo sonecas matinais).
        // Se essa janela está vazia, fallback pra noite mais recente disponível.
        const sleepBreak = (() => {
          // Constrói janela em ms epoch usando TZ local do device.
          const [ay, am, ad] = anchorDayKey.split('-').map((v) => parseInt(v, 10));
          const sleepWindowStart = new Date(ay, am - 1, ad - 1, 18, 0, 0, 0).getTime(); // 18h dia anterior
          const sleepWindowEnd = new Date(ay, am - 1, ad, 12, 0, 0, 0).getTime();        // 12h anchor day
          const inSleepWindow = (rows: SampleRow[]) => rows.filter((r) => {
            const t = new Date(r.ts).getTime();
            return t >= sleepWindowStart && t < sleepWindowEnd;
          });

          let rowsToUse = inSleepWindow(sleepRows);
          let isStale = false;

          if (rowsToUse.length === 0 && sleepRows.length > 0) {
            // Fallback: agrupa por noite (chave = dia LOCAL onde a noite terminou).
            // Para cada sample, calcula nightKey: se ts em horário 0-12h LOCAL,
            // pertence à noite que TERMINOU naquele dia; senão (12-24h), à noite
            // do dia SEGUINTE.
            const nightKeyOf = (iso: string): string => {
              const d = new Date(iso);
              const hour = d.getHours();
              const dt = new Date(d);
              if (hour >= 12) dt.setDate(dt.getDate() + 1);
              const y = dt.getFullYear();
              const m = String(dt.getMonth() + 1).padStart(2, '0');
              const day = String(dt.getDate()).padStart(2, '0');
              return `${y}-${m}-${day}`;
            };
            const mostRecentNight = nightKeyOf(sleepRows[0].ts);
            rowsToUse = sleepRows.filter((r) => nightKeyOf(r.ts) === mostRecentNight);
            isStale = true;
          }

          if (rowsToUse.length === 0) return null;
          let totalMin = 0, rem = 0, light = 0, deep = 0;
          for (const r of rowsToUse) {
            const stage = ((r.payload_json as Record<string, unknown>)?.stage ?? '') as string;
            const dur = Number((r.payload_json as Record<string, unknown>)?.duration_min ?? 1);
            totalMin += dur;
            const s = stage.toLowerCase();
            if (s.includes('rem')) rem += dur;
            else if (s.includes('deep') || s.includes('profundo')) deep += dur;
            else if (s.includes('light') || s.includes('leve')) light += dur;
          }
          const out: SleepBreakdown = {
            totalHours: Math.round((totalMin / 60) * 10) / 10,
          };
          if (rem || light || deep) {
            out.rem = Math.round((rem / 60) * 10) / 10;
            out.light = Math.round((light / 60) * 10) / 10;
            out.deep = Math.round((deep / 60) * 10) / 10;
          }
          return { ...out, isStale };
        })();

        // Aggregations
        const hr = aggregate(hrRows, (xs) => mean(xs), [30, 220]);
        const hrv = aggregate(hrvRows, (xs) => xs[0] ?? null, [5, 250]); // most-recent (rows pré-ordenados)
        const spo2 = aggregate(spo2Rows, (xs) => mean(xs), [70, 100]);
        const rr = aggregate(rrRows, (xs) => mean(xs), [200, 2000]);
        const temp = aggregate(tempRows, (xs) => xs[0] ?? null, [25, 42]);
        const stress = aggregate(stressRows, (xs) => xs[0] ?? null, [0, 100]);
        const stepsAgg = aggregate(stepsRows, (xs) => Math.max(...xs));

        // RHR: direct measure first, else derive from HR p10 of anchor day
        const rhr = (() => {
          const direct = aggregate(rhrRows, (xs) => mean(xs), [30, 100]);
          if (direct.value != null) return { ...direct, derived: false };
          const hrVals = numValues(inAnchorDay(hrRows)).filter((v) => v >= 30 && v <= 220);
          if (hrVals.length >= 5) {
            const sorted = [...hrVals].sort((a, b) => a - b);
            const p10idx = Math.max(0, Math.floor(sorted.length * 0.1) - 1);
            return { value: sorted[p10idx], n: hrVals.length, ts: lastTs(inAnchorDay(hrRows)), isStale: false, derived: true };
          }
          // Fallback 7d: derive from full HR
          const allHr = numValues(hrRows).filter((v) => v >= 30 && v <= 220);
          if (allHr.length >= 5) {
            const sorted = [...allHr].sort((a, b) => a - b);
            const p10idx = Math.max(0, Math.floor(sorted.length * 0.1) - 1);
            return { value: sorted[p10idx], n: allHr.length, ts: lastTs(hrRows), isStale: true, derived: true };
          }
          return { ...direct, derived: false };
        })();

        // Stress fallback: derive from HRV if direct missing
        const stressFinal = (() => {
          if (stress.value != null) return { ...stress, derived: false };
          if (hrv.value != null) {
            const v = Math.max(0, Math.min(100, 100 - hrv.value * 1.2));
            return { value: v, n: hrv.n, ts: hrv.ts, isStale: hrv.isStale, derived: true };
          }
          return { ...stress, derived: false };
        })();

        const out: BiomarkerCard[] = [
          {
            key: 'hr', label: 'Freq. Cardíaca', Icon: Heart,
            value: hr.value != null ? `${Math.round(hr.value)}` : '—',
            rawNum: hr.value, unit: 'bpm',
            detail: hr.value != null ? `n=${hr.n}` : undefined,
            isStale: hr.isStale,
            lastTimestamp: formatLastTs(hr.ts),
          },
          {
            key: 'rhr', label: 'FC Repouso', Icon: HeartPulse,
            value: rhr.value != null ? `${Math.round(rhr.value)}` : '—',
            rawNum: rhr.value, unit: 'bpm',
            detail: rhr.derived ? `derivado p10 · n=${rhr.n}` : rhr.value != null ? `n=${rhr.n}` : undefined,
            isStale: rhr.isStale,
            lastTimestamp: formatLastTs(rhr.ts),
          },
          {
            key: 'hrv', label: 'HRV', Icon: Activity,
            value: hrv.value != null ? `${Math.round(hrv.value)}` : '—',
            rawNum: hrv.value, unit: 'ms',
            detail: hrv.value != null ? `n=${hrv.n}` : undefined,
            qualityNote: hrv.value == null ? 'Sem leitura válida' : undefined,
            isStale: hrv.isStale,
            lastTimestamp: formatLastTs(hrv.ts),
          },
          {
            key: 'rr', label: 'RR Intervals', Icon: Waves,
            value: rr.value != null ? `${Math.round(rr.value)}` : '—',
            rawNum: rr.value, unit: 'ms',
            detail: rr.value != null ? `n=${rr.n}` : undefined,
            isStale: rr.isStale,
            lastTimestamp: formatLastTs(rr.ts),
          },
          {
            key: 'sleep', label: 'Sono', Icon: Moon,
            value: sleepBreak && sleepBreak.totalHours > 0 ? `${sleepBreak.totalHours}h` : '—',
            rawNum: sleepBreak?.totalHours ?? null, unit: '',
            detail: sleepBreak
              ? [
                  (sleepBreak.rem ?? 0) > 0 ? `REM ${sleepBreak.rem}h` : null,
                  `Leve ${sleepBreak.light ?? 0}h`,
                  `Prof ${sleepBreak.deep ?? 0}h`,
                ].filter(Boolean).join(' · ')
              : undefined,
            qualityNote: !sleepBreak ? 'Sem registro 7d' : undefined,
            isStale: sleepBreak?.isStale ?? true,
            lastTimestamp: formatLastTs(lastTs(sleepRows)),
          },
          {
            key: 'spo2', label: 'SpO₂', Icon: Droplets,
            value: spo2.value != null ? `${Math.round(spo2.value)}` : '—',
            rawNum: spo2.value, unit: '%',
            detail: spo2.value != null ? `n=${spo2.n}` : undefined,
            isStale: spo2.isStale,
            lastTimestamp: formatLastTs(spo2.ts),
          },
          {
            key: 'temp', label: 'Temperatura', Icon: Thermometer,
            value: temp.value != null ? `${temp.value.toFixed(1)}` : '—',
            rawNum: temp.value, unit: '°C',
            detail: temp.value != null ? `pele · n=${temp.n}` : undefined,
            isStale: temp.isStale,
            lastTimestamp: formatLastTs(temp.ts),
          },
          {
            key: 'stress', label: 'Estresse', Icon: Brain,
            value: stressFinal.value != null ? `${Math.round(stressFinal.value)}` : '—',
            rawNum: stressFinal.value, unit: '',
            detail: stressFinal.derived ? `derivado de HRV ${Math.round(hrv.value ?? 0)}ms` : stressFinal.value != null ? `n=${stressFinal.n}` : undefined,
            isStale: stressFinal.isStale,
            lastTimestamp: formatLastTs(stressFinal.ts),
          },
          {
            key: 'steps', label: 'Passos', Icon: Footprints,
            value: stepsAgg.value != null ? `${stepsAgg.value.toLocaleString('pt-BR')}` : '—',
            rawNum: stepsAgg.value, unit: '',
            detail: stepsAgg.value != null ? `n=${stepsAgg.n}` : undefined,
            isStale: stepsAgg.isStale,
            lastTimestamp: formatLastTs(stepsAgg.ts),
          },
          {
            key: 'ppg', label: 'PPG (raw)', Icon: Zap,
            value: ppgRows.length ? `${ppgRows.length.toLocaleString('pt-BR')}` : '—',
            rawNum: ppgRows.length || null, unit: 'amostras',
            detail: ppgRows.length ? '7d · 24-bit ADC' : undefined,
            isStale: false,
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

  if (loading) {
    return <div className="font-mono text-[10px] tracking-wide2 text-ds-ink2 uppercase py-6 px-1">Carregando biomarcadores…</div>;
  }

  const filledCount = cards.filter((c) => c.rawNum != null && !c.isStale).length;
  const totalCount = cards.length;

  return (
    <section className="px-1 mt-8">
      <div className="flex items-baseline justify-between mb-4">
        <h3
          className="text-[22px] font-light tracking-[-0.01em] text-ds-ink0"
          style={{ fontFamily: '"Inter Tight", Inter, sans-serif' }}
        >
          Biomarcadores · {anchorDay ? formatDay(anchorDay) : ''}
        </h3>
        <span className="font-mono text-[10px] tracking-wide2 uppercase text-ds-ink2">
          {filledCount}/{totalCount} hoje
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {cards.map((c) => {
          const isNull = c.rawNum == null;
          // 2026-05-16: só desbota quando NÃO há dado nenhum nem em 7d.
          // Cards "anterior" mantêm cor normal — diferenciação é só o badge.
          const isDim = isNull;
          return (
            <div
              key={c.key}
              className="bg-ds-bg2 border border-white/[0.08] rounded-[4px] p-3"
            >
              <div className="flex items-center gap-1.5 mb-2">
                <c.Icon size={12} strokeWidth={1.5} className={isDim ? 'text-ds-ink3' : 'text-ds-ink1'} />
                <span className={`font-mono text-[10px] tracking-wide2 uppercase ${isDim ? 'text-ds-ink3' : 'text-ds-ink2'} flex-1 truncate`}>
                  {c.label}
                </span>
                {c.isStale && !isNull && (
                  <span className="font-mono text-[8px] tracking-wide1 text-ds-ink3 uppercase whitespace-nowrap">
                    anterior
                  </span>
                )}
              </div>
              <div className={`font-mono text-[24px] tracking-[-0.02em] leading-none ${isDim ? 'text-ds-ink3' : 'text-ds-ink0'}`}
                   style={{ fontVariantNumeric: 'tabular-nums' }}>
                {c.value}
                {!isNull && c.unit && <span className="text-[10px] text-ds-ink2 ml-1">{c.unit}</span>}
              </div>
              {c.detail && (
                <div className="font-mono text-[9px] tracking-wide1 text-ds-ink2 mt-2 uppercase leading-tight">
                  {c.detail}
                </div>
              )}
              {c.qualityNote && (
                <div className="font-mono text-[9px] tracking-wide1 text-ds-ink3 mt-1.5 italic">
                  {c.qualityNote}
                </div>
              )}
              {c.lastTimestamp && (
                <div className="font-mono text-[9px] tracking-wide1 text-ds-ink3 mt-1 uppercase">
                  Última: {c.lastTimestamp}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
