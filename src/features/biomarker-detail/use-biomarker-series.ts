import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

const RING_SOURCES = ['parse_vendor_raw', 'qring_ble', 'jstyle', 'ring_daily_backfill'];

export type Range = 'day' | 'week' | 'month';
export type SeriesPoint = { bucketKey: string; value: number; label: string };
export type Reducer = 'mean' | 'last' | 'max' | 'count';

type Opts = {
  types: string[];
  validRange?: [number, number];
  reducer: Reducer;
  /** Escala aplicada ao valor APÓS o reduce. Ex: minutos→horas em sleep. */
  scale?: (v: number) => number;
};

type SampleRow = { value: number | null; ts: string; payload_json: unknown };

function pad(n: number): string { return String(n).padStart(2, '0'); }

function bucketKey(iso: string, granularity: 'hour' | 'day'): string {
  const d = new Date(iso);
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return granularity === 'hour' ? `${base}T${pad(d.getHours())}` : base;
}

function listBuckets(range: Range, anchor: Date): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  if (range === 'day') {
    const base = new Date(anchor); base.setHours(0, 0, 0, 0);
    for (let h = 0; h < 24; h++) {
      const d = new Date(base); d.setHours(h);
      out.push({ key: bucketKey(d.toISOString(), 'hour'), label: `${pad(h)}h` });
    }
  } else {
    const n = range === 'week' ? 7 : 30;
    const wk = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(anchor); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0);
      const key = bucketKey(d.toISOString(), 'day');
      const label = n === 7 ? wk[d.getDay()] : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
      out.push({ key, label });
    }
  }
  return out;
}

/**
 * Carrega samples de biomarker e agrega em buckets de hora (range=day) ou
 * dia (week/month) na timezone local. Buckets vazios viram value=0 com
 * label preservado pra manter o eixo X estável.
 */
export function useBiomarkerSeries(range: Range, opts: Opts) {
  const [data, setData] = useState<SeriesPoint[] | null>(null);
  const [loading, setLoading] = useState(true);

  // dep estável: types como string + reducer + range
  const typesKey = opts.types.join(',');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const hours = range === 'day' ? 24 : range === 'week' ? 24 * 7 : 24 * 30;
        const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();

        const { data: rows } = await supabase
          .from('biomarker_samples')
          .select('value, payload_json, ts')
          .eq('user_id', user.id)
          .in('type', opts.types)
          .in('source', RING_SOURCES)
          .gte('ts', since)
          .order('ts', { ascending: false })
          .limit(3000);

        const granularity = range === 'day' ? 'hour' : 'day';
        const buckets = listBuckets(range, new Date());
        const byKey = new Map<string, number[]>();

        for (const r of (rows ?? []) as SampleRow[]) {
          const v = Number(r.value);
          if (!Number.isFinite(v)) continue;
          if (opts.validRange && (v < opts.validRange[0] || v > opts.validRange[1])) continue;
          const k = bucketKey(r.ts, granularity);
          if (!byKey.has(k)) byKey.set(k, []);
          byKey.get(k)!.push(v);
        }

        const out: SeriesPoint[] = buckets.map((b) => {
          const vals = byKey.get(b.key);
          if (!vals || vals.length === 0) return { bucketKey: b.key, value: 0, label: b.label };
          let v: number;
          if (opts.reducer === 'mean') v = vals.reduce((a, n) => a + n, 0) / vals.length;
          else if (opts.reducer === 'last') v = vals[0];
          else if (opts.reducer === 'max') v = Math.max(...vals);
          else v = vals.length;
          if (opts.scale) v = opts.scale(v);
          return { bucketKey: b.key, value: Math.round(v * 10) / 10, label: b.label };
        });

        if (!cancelled) setData(out);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [range, typesKey, opts.reducer]);

  return { data, loading };
}

/** Mapeia card.key → params do hook. Mantém pareado com BiomarkersGrid. */
export const METRIC_QUERY: Record<string, {
  types: string[];
  validRange?: [number, number];
  reducer: Reducer;
  scale?: (v: number) => number;
  chartType: 'line' | 'bar';
}> = {
  hr:     { types: ['hr', 'heart_rate'],          validRange: [30, 220],  reducer: 'mean', chartType: 'line' },
  rhr:    { types: ['rhr'],                       validRange: [30, 100],  reducer: 'mean', chartType: 'line' },
  hrv:    { types: ['hrv', 'hrv_rmssd', 'rmssd'], validRange: [5, 250],   reducer: 'mean', chartType: 'line' },
  rr:     { types: ['rr_interval'],               validRange: [200, 2000],reducer: 'mean', chartType: 'line' },
  sleep:  { types: ['sleep'],                                              reducer: 'count', scale: (v) => v / 60, chartType: 'bar' },
  spo2:   { types: ['spo2', 'oxygen_saturation'], validRange: [70, 100],  reducer: 'mean', chartType: 'line' },
  temp:   { types: ['temp', 'body_temp', 'skin_temp'], validRange: [25, 42], reducer: 'mean', chartType: 'line' },
  stress: { types: ['stress', 'stress_level'],    validRange: [0, 100],   reducer: 'mean', chartType: 'line' },
  steps:  { types: ['steps'],                                              reducer: 'max',  chartType: 'bar' },
  ppg:    { types: ['ppg'],                                                reducer: 'count', chartType: 'bar' },
};
