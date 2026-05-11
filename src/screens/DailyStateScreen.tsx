import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '@/components/BottomNav';
import { AppHeader } from '@/design-system/components/AppHeader';
import { DateRow } from '@/design-system/components/DateRow';
import { DailyStateChart, type HourlyPoint } from '@/design-system/components/DailyStateChart';
import { SachetGlyph } from '@/design-system/components/SachetGlyph';
import { useSachetIntakes } from '@/features/sachets/use-sachet-intakes';
import { supabase } from '@/integrations/supabase/client';

export default function DailyStateScreen() {
  const nav = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const { intakes } = useSachetIntakes(today);
  const [hourly, setHourly] = useState<HourlyPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Não autenticado');
        const { data, error } = await supabase.rpc('get_hourly_state', { p_user_id: user.id, p_day: today });
        if (error) throw error;
        const rows = (data ?? []) as Array<Record<string, unknown>>;
        const points: HourlyPoint[] = Array.from({ length: 24 }, (_, h) => {
          const r = rows.find((x) => Number(x.hour) === h);
          return {
            hour: h,
            hrAvg: r?.hr_avg != null ? Number(r.hr_avg) : null,
            hrMin: r?.hr_min != null ? Number(r.hr_min) : null,
            hrMax: r?.hr_max != null ? Number(r.hr_max) : null,
          };
        });
        if (!cancelled) setHourly(points);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [today]);

  const validCount = hourly.filter((p) => p.hrAvg != null).length;

  return (
    <div className="min-h-dvh bg-ds-bg0 text-ds-ink0 pb-24" style={{ fontFamily: 'Inter, sans-serif' }}>
      <header className="px-4 pt-12">
        <AppHeader variant="detail" title="ESTADO · DIA" onBack={() => nav('/insights')} />
      </header>

      <main className="px-4 pt-2">
        <DateRow date={today} />

        {loading ? (
          <div className="py-12 text-center font-mono text-[11px] tracking-wide2 text-ds-ink2 uppercase">Carregando…</div>
        ) : error ? (
          <p className="text-ds-ink1 text-sm py-8">{error}</p>
        ) : validCount === 0 ? (
          <p className="text-ds-ink1 text-sm py-8">
            Sem leituras de batimento hoje. Sincronize o anel para ver o estado por hora.
          </p>
        ) : (
          <>
            <h2
              className="text-[22px] font-light tracking-[-0.01em] mb-4 text-ds-ink0 px-1"
              style={{ fontFamily: '"Inter Tight", Inter, sans-serif' }}
            >
              Frequência cardíaca · 24h
            </h2>
            <DailyStateChart
              hourly={hourly}
              sachets={intakes.map((i) => ({ hour: i.hour, type: i.sachetType }))}
            />

            {/* Sachet legend */}
            <div className="mt-5 px-1">
              <div className="font-mono text-[10px] tracking-wide2 uppercase text-ds-ink2 mb-3">Sachets hoje</div>
              {intakes.length === 0 ? (
                <p className="text-sm text-ds-ink2">Nenhum sachet registrado.</p>
              ) : (
                <ul className="space-y-2">
                  {intakes.map((i) => (
                    <li key={i.id} className="flex items-center gap-2 text-sm text-ds-ink1">
                      <SachetGlyph type={i.sachetType} />
                      <span className="font-mono text-[11px] tracking-wide1 text-ds-ink0">
                        {i.sachetType}
                      </span>
                      <span className="text-ds-ink2 ml-auto font-mono text-[11px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {String(Math.floor(i.hour)).padStart(2, '0')}:{String(Math.floor((i.hour % 1) * 60)).padStart(2, '0')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2 mt-6 px-1">
              {(() => {
                const values = hourly.filter((p) => p.hrAvg != null).map((p) => p.hrAvg!);
                const avg = values.reduce((a, b) => a + b, 0) / values.length;
                const min = Math.min(...values);
                const max = Math.max(...values);
                return (
                  <>
                    <Stat label="Médio" value={avg.toFixed(0)} unit="bpm" />
                    <Stat label="Mín" value={min.toFixed(0)} unit="bpm" />
                    <Stat label="Máx" value={max.toFixed(0)} unit="bpm" />
                  </>
                );
              })()}
            </div>
          </>
        )}
      </main>

      <BottomNav />
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="bg-ds-bg2 border border-white/[0.08] rounded-[4px] p-3">
      <div className="font-mono text-[9px] tracking-wide2 text-ds-ink2 uppercase mb-1.5">{label}</div>
      <div className="font-mono text-[20px] text-ds-ink0" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
        <span className="text-[10px] text-ds-ink2 ml-1">{unit}</span>
      </div>
    </div>
  );
}
