/**
 * vyr-collector.ts — Camada única de coleta de biomarcadores (F6)
 *
 * Detecta a plataforma e roteia para o provider correto:
 *   iOS     → Apple Health via VYRHealthBridge + @capgo/capacitor-health
 *   Android → Health Connect via AndroidHealthProvider
 *   Web     → noop (retorna false)
 *
 * Responsabilidades:
 *   — Verificar disponibilidade e permissões
 *   — Executar o sync completo (ring_daily_data + features + Edge Function)
 *   — Expor status de conexão de forma uniforme
 *
 * NÃO contém lógica de computação — apenas coleta e dispara o pipeline.
 */

import { syncHealthKitData, requestHealthKitPermissions, isHealthKitAvailable, checkHealthKitPermissions } from './healthkit';

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

/**
 * Retorna o status atual do collector — disponibilidade + permissões.
 * Usado pelo Home para exibir o banner de conexão.
 */
export async function getCollectorStatus(): Promise<CollectorStatus> {
  const platform = detectPlatform();

  if (platform === 'web') {
    return { platform, available: false, hasPermissions: false, lastSyncAt: null };
  }

  const available = await isHealthKitAvailable();
  const hasPermissions = available ? await checkHealthKitPermissions() : false;
  const lastSyncAt = localStorage.getItem('vyr.collector.lastSync');

  return { platform, available, hasPermissions, lastSyncAt };
}

/**
 * Solicita permissões de saúde ao usuário.
 * Retorna true se permissões foram concedidas.
 */
export async function requestCollectorPermissions(): Promise<boolean> {
  const platform = detectPlatform();
  if (platform === 'web') return false;
  return requestHealthKitPermissions();
}

/**
 * Executa a coleta completa de biomarcadores para hoje.
 *
 * Internamente:
 *   1. syncHealthKitData() — lê wearable, salva ring_daily_data
 *   2. computeAndStoreFeatures() — calcula as 8 features derivadas (chamado dentro do sync)
 *   3. computeStateViaEdge() — Edge Function calcula score v4 server-side (chamado dentro do sync)
 *
 * @returns true se sync foi bem-sucedido
 */
export async function collect(): Promise<boolean> {
  const platform = detectPlatform();
  if (platform === 'web') {
    console.warn('[vyr-collector] Web platform — collect is a no-op');
    return false;
  }

  const available = await isHealthKitAvailable();
  if (!available) {
    console.warn('[vyr-collector] Health middleware not available');
    return false;
  }

  const ok = await syncHealthKitData();

  if (ok) {
    localStorage.setItem('vyr.collector.lastSync', new Date().toISOString());
    console.info('[vyr-collector] Collect complete —', platform);
  }

  return ok;
}

/**
 * Retorna quantos dias completos de dados o usuário tem.
 * Usado para determinar o modo do engine (bootstrap / adaptive / ml_ready).
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
