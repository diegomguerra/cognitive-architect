/**
 * vyr-collector.ts — Camada única de coleta de biomarcadores.
 *
 * Reescrito 2026-05-16: HealthKit removido. Toda coleta agora vem via BLE
 * do anel (QRing/JStyle/Colmi). Web platform = no-op.
 *
 * Responsabilidades:
 *   — Verificar disponibilidade de BLE + presença de anel pareado
 *   — Disparar sync QRing + recompute VYR state
 *   — Expor status de conexão de forma uniforme
 */

import { runQRingSyncIfPaired, getLastPairedQRing } from '@/wearables/wearable.sync';
import { computeAndStoreState } from './vyr-recompute';

export type CollectorPlatform = 'ios' | 'android' | 'web';

export interface CollectorStatus {
  platform: CollectorPlatform;
  available: boolean;
  hasPermissions: boolean;
  lastSyncAt: string | null;
}

function detectPlatform(): CollectorPlatform {
  const cap = (window as any).Capacitor;
  if (!cap?.isNativePlatform?.()) return 'web';
  const platform = cap.getPlatform?.() ?? '';
  if (platform === 'android') return 'android';
  if (platform === 'ios') return 'ios';
  return 'web';
}

export async function getCollectorStatus(): Promise<CollectorStatus> {
  const platform = detectPlatform();

  if (platform === 'web') {
    return { platform, available: false, hasPermissions: false, lastSyncAt: null };
  }

  // Anel pareado = "available". BLE permission é granted no momento da conexão
  // via RingPairingFlow, então hasPermissions reflete presença do device.
  const paired = !!getLastPairedQRing();
  const lastSyncAt = localStorage.getItem('vyr.collector.lastSync');

  return { platform, available: true, hasPermissions: paired, lastSyncAt };
}

/**
 * requestCollectorPermissions — pós HealthKit removal.
 * BLE permissions são pedidas implícitamente no RingPairingFlow. Aqui é no-op
 * que retorna true se anel já pareado, false se não.
 */
export async function requestCollectorPermissions(): Promise<boolean> {
  const platform = detectPlatform();
  if (platform === 'web') return false;
  return !!getLastPairedQRing();
}

/**
 * Executa coleta completa de biomarcadores. Pós HealthKit removal:
 * roda QRing sync + recompute via vyr-compute-state edge function.
 */
export async function collect(): Promise<boolean> {
  const platform = detectPlatform();
  if (platform === 'web') {
    console.warn('[vyr-collector] Web platform — collect is a no-op');
    return false;
  }

  const summary = await runQRingSyncIfPaired().catch(() => ({ ran: false }));
  try { await computeAndStoreState(); } catch {}

  if (summary.ran) {
    localStorage.setItem('vyr.collector.lastSync', new Date().toISOString());
    console.info('[vyr-collector] Collect complete —', platform, summary);
  }

  return summary.ran;
}

/**
 * Retorna quantos dias completos de dados o usuário tem.
 * Lê de computed_states via Supabase.
 */
export async function getDataDays(userId: string): Promise<number> {
  try {
    const { supabase } = await import('@/integrations/supabase/client');
    const { count } = await supabase
      .from('computed_states')
      .select('day', { count: 'exact', head: true })
      .eq('user_id', userId);
    return count ?? 0;
  } catch {
    return 0;
  }
}
