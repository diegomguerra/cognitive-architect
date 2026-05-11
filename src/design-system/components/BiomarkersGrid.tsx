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
  freshness?: string;       // "há 5min"
  lastTimestamp?: string;   // "11/05 02:08"
};

type SleepBreakdown = {
  totalHours: number;
  rem?: number;
  light?: number;
  deep?: number;
};

type SampleRow = { value: number | null; payload_json: unknown; ts: string; end_ts?: string | null };

const RING_SOURCES = ['parse_vendor_raw', 'qring_ble', 'jstyle', 'ring_daily_backfill'];

/** "11/05 02:08" — data + hora absoluta, formato pt-BR. */
function formatLastTs(latestIso: string | null): string | undefined {
  if (!latestIso) return undefined;
  const d = new Date(latestIso);
  if (isNaN(d.getTime())) return undefined;
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

/** "agora" / "há 5min" / "há 2h" / "há 3d" — relativo curto pra contexto. */
function relativeLabel(latestIso: string | null): string | undefined {
  if (!latestIso) return undefined;
  const ageMs = Date.now() - new Date(latestIso).getTime();
  const min = Math.floor(ageMs / 60_000);
  if (min < 60) return min < 5 ? 'agora' : `há ${min}min`;
  if (min < 1440) return `há ${Math.floor(min / 60)}h`;
  return `há ${Math.floor(min / 1440)}d`;
}

/**
 * Grid de cards com 10 biomarcadores nas últimas 7d (janela maior pra capturar
 * tipos esparsos como sleep/temp/stress). Cada card mostra freshness (há Xd).
 */
export function BiomarkersGrid() {
  const [cards, setCards] = useState<BiomarkerCard[]>([]);
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

        const numValues = (rows: SampleRow[]) =>
          rows.map((r) => Number(r.value)).filter((v) => Number.isFinite(v));

        const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
        const last = (rows: SampleRow[]) => {
          const r = rows.find((x) => x.value != null && Number.isFinite(Number(x.value)));
          return r ? Number(r.value) : null;
        };
        const lastTs = (rows: SampleRow[]) => rows[0]?.ts ?? null;

        /**
         * Regra Diego 2026-05-10: para biomarkers intermitentes (sleep/temp/stress),
         * priorizar última leitura recente (24h pra temp/stress, 12h pra sleep)
         * e cair pra média 7d com label se não houver. Nunca mostrar "—" se há dado 7d.
         */
        const latestOrAvg = (rows: SampleRow[], freshHours: number, validRange?: [number, number]): { value: number | null; isAverage: boolean } => {
          const cutoffMs = Date.now() - freshHours * 3600_000;
          const valid = rows.filter((r) => {
            const v = Number(r.value);
            if (!Number.isFinite(v)) return false;
            if (validRange && (v < validRange[0] || v > validRange[1])) return false;
            return true;
          });
          if (valid.length === 0) return { value: null, isAverage: false };
          const recent = valid.filter((r) => new Date(r.ts).getTime() >= cutoffMs);
          if (recent.length > 0) return { value: Number(recent[0].value), isAverage: false };
          // Fallback: média de tudo que tiver no range (já filtrado por 7d na query)
          const xs = valid.map((r) => Number(r.value));
          return { value: mean(xs), isAverage: true };
        };

        // Sleep breakdown (REM/Leve/Profundo a partir do payload.stage)
        const sleepBreak = (() => {
          const out: SleepBreakdown = { totalHours: 0 };
          if (sleepRows.length === 0) return null;
          let totalMin = 0, rem = 0, light = 0, deep = 0;
          for (const r of sleepRows) {
            const stage = ((r.payload_json as Record<string, unknown>)?.stage ?? '') as string;
            const dur = Number((r.payload_json as Record<string, unknown>)?.duration_min ?? 1);
            totalMin += dur;
            const s = stage.toLowerCase();
            if (s.includes('rem')) rem += dur;
            else if (s.includes('deep') || s.includes('profundo')) deep += dur;
            else if (s.includes('light') || s.includes('leve')) light += dur;
          }
          out.totalHours = Math.round((totalMin / 60) * 10) / 10;
          if (rem || light || deep) {
            out.rem = Math.round((rem / 60) * 10) / 10;
            out.light = Math.round((light / 60) * 10) / 10;
            out.deep = Math.round((deep / 60) * 10) / 10;
          }
          return out;
        })();

        // Validation per type
        const hrVals = numValues(hrRows).filter((v) => v >= 30 && v <= 220);
        const hrvVals = numValues(hrvRows).filter((v) => v >= 5 && v <= 250);
        const spo2Vals = numValues(spo2Rows).filter((v) => v >= 70 && v <= 100);
        const rrVals = numValues(rrRows).filter((v) => v >= 200 && v <= 2000);
        const rhrVals = numValues(rhrRows).filter((v) => v >= 30 && v <= 100);
        const stepsVals = numValues(stepsRows);
        const stepsTotal = stepsVals.length ? Math.max(...stepsVals) : null;

        // Sleep/temp/stress com fallback média 7d
        const tempReading = latestOrAvg(tempRows, 24, [25, 42]);
        const stressReading = latestOrAvg(stressRows, 24, [0, 100]);
        // Sleep: usa total da última noite se houver, senão média
        const sleepReading = (() => {
          if (!sleepBreak) return { totalH: null as number | null, isAverage: false };
          const cutoffMs = Date.now() - 12 * 3600_000;
          const recentSleepRow = sleepRows.find((r) => new Date(r.ts).getTime() >= cutoffMs);
          if (recentSleepRow) return { totalH: sleepBreak.totalHours, isAverage: false };
          // Fallback: média de horas/noite. Sleep samples vêm como segmentos por minuto;
          // agrupa por dia e divide por número de dias com dados.
          const byDay = new Map<string, number>();
          for (const r of sleepRows) {
            const dayKey = new Date(r.ts).toISOString().slice(0, 10);
            const dur = Number((r.payload_json as Record<string, unknown>)?.duration_min ?? 1);
            byDay.set(dayKey, (byDay.get(dayKey) ?? 0) + dur);
          }
          const nights = byDay.size;
          if (nights === 0) return { totalH: null, isAverage: true };
          const totalMin = Array.from(byDay.values()).reduce((a, b) => a + b, 0);
          return { totalH: Math.round((totalMin / nights / 60) * 10) / 10, isAverage: true };
        })();

        const make = (rows: SampleRow[], fields: Omit<BiomarkerCard, 'freshness' | 'lastTimestamp'>): BiomarkerCard => ({
          ...fields,
          freshness: relativeLabel(lastTs(rows)),
          lastTimestamp: formatLastTs(lastTs(rows)),
        });

        const out: BiomarkerCard[] = [
          make(hrRows, {
            key: 'hr', label: 'Freq. Cardíaca', Icon: Heart,
            value: hrVals.length ? `${Math.round(mean(hrVals)!)}` : '—',
            rawNum: hrVals.length ? mean(hrVals) : null, unit: 'bpm',
            detail: hrVals.length ? `min ${Math.round(Math.min(...hrVals))} · max ${Math.round(Math.max(...hrVals))}` : undefined,
          }),
          make(rhrRows, {
            key: 'rhr', label: 'FC Repouso', Icon: HeartPulse,
            value: rhrVals.length ? `${Math.round(mean(rhrVals)!)}` : '—',
            rawNum: rhrVals.length ? mean(rhrVals) : null, unit: 'bpm',
            detail: rhrVals.length ? `n=${rhrVals.length}` : undefined,
          }),
          make(hrvRows, {
            key: 'hrv', label: 'HRV', Icon: Activity,
            value: hrvVals.length ? `${Math.round(hrvVals[0])}` : '—',
            rawNum: hrvVals.length ? hrvVals[0] : null, unit: 'ms',
            detail: hrvVals.length ? `n=${hrvVals.length} · avg ${Math.round(mean(hrvVals)!)}ms` : undefined,
            qualityNote: hrvVals.length === 0 ? 'Sem leitura válida' : undefined,
          }),
          make(rrRows, {
            key: 'rr', label: 'RR Intervals', Icon: Waves,
            value: rrVals.length ? `${Math.round(mean(rrVals)!)}` : '—',
            rawNum: rrVals.length ? mean(rrVals) : null, unit: 'ms',
            detail: rrVals.length ? `n=${rrVals.length}` : undefined,
          }),
          make(sleepRows, {
            key: 'sleep', label: 'Sono', Icon: Moon,
            value: sleepReading.totalH != null && sleepReading.totalH > 0 ? `${sleepReading.totalH}h` : '—',
            rawNum: sleepReading.totalH,
            unit: sleepReading.isAverage ? 'média 7d' : '',
            detail: !sleepReading.isAverage && sleepBreak && (sleepBreak.rem || sleepBreak.light || sleepBreak.deep)
              ? `REM ${sleepBreak.rem ?? 0}h · Leve ${sleepBreak.light ?? 0}h · Prof ${sleepBreak.deep ?? 0}h`
              : sleepReading.isAverage ? 'Sem leitura recente' : undefined,
            qualityNote: sleepReading.totalH == null ? 'Sem registro 7d' : undefined,
          }),
          make(spo2Rows, {
            key: 'spo2', label: 'SpO₂', Icon: Droplets,
            value: spo2Vals.length ? `${Math.round(mean(spo2Vals)!)}` : '—',
            rawNum: spo2Vals.length ? mean(spo2Vals) : null, unit: '%',
            detail: spo2Vals.length ? `n=${spo2Vals.length}` : undefined,
          }),
          make(tempRows, {
            key: 'temp', label: 'Temperatura', Icon: Thermometer,
            value: tempReading.value != null ? `${tempReading.value.toFixed(1)}` : '—',
            rawNum: tempReading.value,
            unit: tempReading.isAverage ? '°C · média 7d' : '°C',
            detail: tempReading.isAverage ? `Sem leitura 24h · n=${tempRows.length}` : `pele · n=${tempRows.length}`,
          }),
          make(stressRows, {
            key: 'stress', label: 'Estresse', Icon: Brain,
            value: stressReading.value != null ? `${Math.round(stressReading.value)}` : '—',
            rawNum: stressReading.value,
            unit: stressReading.isAverage ? 'média 7d' : '',
            detail: stressReading.isAverage ? `Sem leitura 24h · n=${stressRows.length}` : `n=${stressRows.length}`,
          }),
          make(stepsRows, {
            key: 'steps', label: 'Passos', Icon: Footprints,
            value: stepsTotal != null ? `${stepsTotal.toLocaleString('pt-BR')}` : '—',
            rawNum: stepsTotal, unit: '',
            detail: stepsVals.length ? `n=${stepsVals.length} dias` : undefined,
          }),
          make(ppgRows, {
            key: 'ppg', label: 'PPG (raw)', Icon: Zap,
            value: ppgRows.length ? `${ppgRows.length.toLocaleString('pt-BR')}` : '—',
            rawNum: ppgRows.length || null, unit: 'amostras',
            detail: ppgRows.length ? '24-bit ADC' : undefined,
          }),
        ];

        if (!cancelled) setCards(out);
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

  return (
    <section className="px-1 mt-8">
      <div className="flex items-baseline justify-between mb-4">
        <h3
          className="text-[22px] font-light tracking-[-0.01em] text-ds-ink0"
          style={{ fontFamily: '"Inter Tight", Inter, sans-serif' }}
        >
          Biomarcadores · 7d
        </h3>
        <span className="font-mono text-[10px] tracking-wide2 uppercase text-ds-ink2">
          {cards.filter((c) => c.rawNum != null).length}/{cards.length}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {cards.map((c) => {
          const isNull = c.rawNum == null;
          return (
            <div
              key={c.key}
              className="bg-ds-bg2 border border-white/[0.08] rounded-[4px] p-3"
            >
              <div className="flex items-center gap-1.5 mb-2">
                <c.Icon size={12} strokeWidth={1.5} className={isNull ? 'text-ds-ink3' : 'text-ds-ink1'} />
                <span className={`font-mono text-[10px] tracking-wide2 uppercase ${isNull ? 'text-ds-ink3' : 'text-ds-ink2'} flex-1 truncate`}>
                  {c.label}
                </span>
                {c.freshness && !isNull && (
                  <span className="font-mono text-[8px] tracking-wide1 text-ds-ink3 uppercase whitespace-nowrap">
                    {c.freshness}
                  </span>
                )}
              </div>
              <div className={`font-mono text-[24px] tracking-[-0.02em] leading-none ${isNull ? 'text-ds-ink3' : 'text-ds-ink0'}`}
                   style={{ fontVariantNumeric: 'tabular-nums' }}>
                {c.value}
                {!isNull && c.unit && <span className="text-[10px] text-ds-ink2 ml-1">{c.unit}</span>}
              </div>
              {c.detail && (
                <div className="font-mono text-[9px] tracking-wide1 text-ds-ink2 mt-2 uppercase truncate">
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
                  Último: {c.lastTimestamp}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
