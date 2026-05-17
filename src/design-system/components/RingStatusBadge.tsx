import { useEffect, useState } from 'react';
import { wearableStore } from '@/wearables/wearable.store';
import { supabase } from '@/integrations/supabase/client';

/** Indicador de freshness do anel — battery + tempo desde última leitura. */
export function RingStatusBadge() {
  const [status, setStatus] = useState<{ battery: number | null; minutesSinceLast: number | null; connected: boolean }>({
    battery: null, minutesSinceLast: null, connected: false,
  });

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const state = wearableStore.getState();
        const pluginBattery = state.diagnostics?.battery ?? null;
        const connected = !!state.connectedDevice;

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Fallback: lê último battery sample do banco se plugin não expõe
        let battery: number | null = pluginBattery;
        if (battery == null) {
          const { data: bat } = await supabase
            .from('biomarker_samples')
            .select('value')
            .eq('user_id', user.id)
            .eq('type', 'battery')
            .order('ts', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (bat?.value != null) battery = Math.round(Number(bat.value));
        }

        const { data: dev } = await supabase.from('devices')
          .select('last_seen_at')
          .eq('user_id', user.id)
          .order('last_seen_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const minutesSinceLast = dev?.last_seen_at
          ? Math.floor((Date.now() - new Date(dev.last_seen_at as string).getTime()) / 60_000)
          : null;

        if (!cancelled) setStatus({ battery, minutesSinceLast, connected });
      } catch { /* silent */ }
    };

    refresh();
    const interval = setInterval(refresh, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Sem nenhum dado ainda
  if (status.battery == null && status.minutesSinceLast == null) {
    return <span className="font-mono text-[10px] tracking-wide1 text-ds-ink2 uppercase px-2">NODE · OFF</span>;
  }

  const fmtTime = (min: number) => {
    if (min < 60) return `${min}m`;
    if (min < 1440) return `${Math.floor(min / 60)}h`;
    return `${Math.floor(min / 1440)}d`;
  };

  const stale = (status.minutesSinceLast ?? 999) > 60;
  const lowBattery = (status.battery ?? 100) < 20;
  // Build 414: ponto VERDE quando conectado E sync fresh. Antes era branco
  // (#FAFAFA) — mesmo conectado o user não distinguia de "desconhecido".
  const dotColor = stale || lowBattery
    ? '#D97706'  // âmbar — atenção (stale ou bateria baixa)
    : status.connected
      ? '#34D399'  // verde — conectado e saudável
      : '#FAFAFA'; // branco — não conectado mas tem dados recentes

  return (
    <span className="font-mono text-[10px] tracking-wide1 text-ds-ink1 uppercase flex items-center gap-1.5 px-2">
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: dotColor, boxShadow: stale ? 'none' : `0 0 6px ${dotColor}` }} />
      NODE
      {status.battery != null && <span> · {status.battery}%</span>}
      {status.minutesSinceLast != null && <span> · {fmtTime(status.minutesSinceLast)}</span>}
    </span>
  );
}
