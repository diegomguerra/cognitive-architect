import { CheckCircle2, AlertCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface WearableInfo {
  provider: string;
  status: string;
  lastSyncAt: string | null;
}

const RING_LABEL: Record<string, string> = {
  qring: 'QRing',
  qring_ble: 'QRing',
  jstyle: 'JStyle',
  colmi: 'Colmi',
};

function formatSyncTime(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `há ${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `há ${hours}h`;
  return `há ${Math.floor(hours / 24)}d`;
}

const ConnectionStatusPill = () => {
  const { session } = useAuth();
  const [wearable, setWearable] = useState<WearableInfo | null>(null);

  useEffect(() => {
    if (!session?.user?.id) return;

    const fetchStatus = async () => {
      // 2026-05-16: anel BLE não cria row em user_integrations. Lê de `devices`
      // (tabela populada no pareamento BLE) que reflete o anel pareado real.
      const { data: device } = await supabase
        .from('devices')
        .select('vendor, model, last_seen_at')
        .eq('user_id', session.user.id)
        .order('last_seen_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      if (device) {
        const label = RING_LABEL[device.vendor] ?? device.vendor;
        setWearable({
          provider: device.model ? `${label} ${device.model}` : label,
          status: 'active',
          lastSyncAt: device.last_seen_at,
        });
      }
    };

    fetchStatus();
  }, [session?.user?.id]);

  if (!wearable) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-destructive/10">
        <AlertCircle size={12} className="text-[#EF4444] animate-pulse" />
        <span className="text-[10px] font-medium text-[#EF4444]">Sem wearable</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: 'hsl(var(--vyr-positive) / 0.1)' }}>
      <CheckCircle2 size={12} className="text-vyr-positive" />
      <span className="text-[10px] font-medium text-vyr-positive">
        {wearable.provider} · {formatSyncTime(wearable.lastSyncAt)}
      </span>
    </div>
  );
};

export default ConnectionStatusPill;
