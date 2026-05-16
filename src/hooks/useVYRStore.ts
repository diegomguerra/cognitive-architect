import { useState, useEffect, useCallback } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { requireValidUserId, retryOnAuthErrorLabeled } from '@/lib/auth-session';
import { getCurrentPhase, computeScore, getLevel, getLimitingFactor } from '@/lib/vyr-engine';
import type { VYRState, PillarScore } from '@/lib/vyr-engine';
// HealthKit removido 2026-05-16 — imports stub mantidos só pra compat de symbols.
// As funções abaixo agora retornam false/no-op (ver src/lib/healthkit.ts).
import { computeAndStoreState } from '@/lib/vyr-recompute';
import { loadTomorrowPrediction, loadTodayAnomaly } from '@/lib/vyr-compute-client';
import type { VYRPrediction, VYRAnomaly } from '@/lib/vyr-compute-client';
import { bootstrapHealthSync, setupAppLifecycleListeners, setConnectionActive, isConnectionActive, startSyncCommandListener, stopSyncCommandListener } from '@/lib/health-lifecycle';

export interface DayEntry {
  day: string;
  score: number;
  level: string;
  pillars: PillarScore;
  phase: string;
}

export interface WearableConnection {
  provider: string;
  status: string;
  lastSyncAt: string | null;
  scopes: string[];
}

export interface ActionLog {
  id: string;
  action_type: string;
  payload: any;
  created_at: string;
}

export interface Checkpoint {
  id: string;
  checkpoint_type: string;
  data: any;
  created_at: string;
}

export interface DailyReview {
  id: string;
  day: string;
  focus_score: number | null;
  clarity_score: number | null;
  energy_score: number | null;
  mood_score: number | null;
  notes: string | null;
}

const emptyState: VYRState = {
  score: 0,
  level: 'Crítico',
  pillars: { energia: 0, clareza: 0, estabilidade: 0 },
  limitingFactor: 'energia',
  phase: getCurrentPhase(),
};

export function useVYRStore() {
  const { session } = useAuth();
  const userId = session?.user?.id;

  const [state, setState] = useState<VYRState>(emptyState);
  const [hasData, setHasData] = useState(false);
  const [loading, setLoading] = useState(true);
  const [historyByDay, setHistoryByDay] = useState<DayEntry[]>([]);
  const [actionLogs, setActionLogs] = useState<ActionLog[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [dailyReviews, setDailyReviews] = useState<DailyReview[]>([]);
  const [wearableConnection, setWearableConnection] = useState<WearableConnection | null>(null);
  const [sachetConfirmation, setSachetConfirmation] = useState<{ show: boolean; phase: string }>({ show: false, phase: 'BOOT' });
  const [userName, setUserName] = useState('');
  // F6 — prediction, anomaly, engine mode
  const [prediction, setPrediction] = useState<VYRPrediction | null>(null);
  const [anomaly, setAnomaly] = useState<VYRAnomaly | null>(null);
  const [dataDays, setDataDays] = useState(0);
  const [dataConfidence, setDataConfidence] = useState<{ confidence_level: string; display_label: string | null; confidence: number } | null>(null);

  const today = new Date().toISOString().split('T')[0];

  /**
   * Reload VYR State from computed_states. If none exists for today,
   * attempts to compute from ring_daily_data (fixes iOS race condition
   * where bootstrapHealthSync is throttled but ring data already exists).
   */
  const refreshStateFromDB = useCallback(async () => {
    if (!userId) return;
    // Reconcile Home com Insights: dispara vyr-compute-state v12 antes de ler.
    // Garante que computed_states reflete o pipeline Phase 2.5 (mesmo cálculo
    // que Insights faz). Silent on failure — fallback é cache antigo.
    try {
      await supabase.functions.invoke('vyr-compute-state', { body: { day: today } });
    } catch (e) {
      console.warn('[useVYRStore] vyr-compute-state invoke failed (silent):', e);
    }

    let { data } = await supabase
      .from('computed_states')
      .select('day, score, level, pillars, phase, raw_input')
      .eq('user_id', userId)
      .eq('day', today)
      .maybeSingle();

    // No computed state yet — try to compute from ring_daily_data
    if (!data) {
      try {
        const computed = await computeAndStoreState(today, userId);
        if (computed) {
          data = {
            day: today,
            score: computed.score,
            level: computed.level,
            pillars: computed.pillars as any,
            phase: computed.phase,
          };
        }
      } catch (e) {
        console.warn('[useVYRStore] refreshStateFromDB compute failed:', e);
      }
    }

    if (data) {
      const p = data.pillars as any;
      const pillars: PillarScore = {
        energia: p?.energia ?? 0,
        clareza: p?.clareza ?? 0,
        estabilidade: p?.estabilidade ?? 0,
      };
      setState({
        score: data.score ?? 0,
        level: data.level ?? 'Crítico',
        pillars,
        limitingFactor: getLimitingFactor(pillars),
        phase: (data.phase as VYRState['phase']) || getCurrentPhase(),
      });
      setHasData(true);
      const ri = (data as any).raw_input;
      if (ri?.data_confidence) setDataConfidence(ri.data_confidence);
    }
  }, [userId, today]);

  /**
   * autoConnect — HEALTHKIT REMOVIDO 2026-05-16. Função vira no-op.
   * VYR não inicia mais Apple Health automaticamente. Conexão de wearable
   * agora se dá exclusivamente via RingPairingFlow (BLE QRing/JStyle).
   */
  const autoConnect = useCallback(async (_uid: string) => {
    // intentional no-op
  }, []);

  const loadData = useCallback(async () => {
    if (!userId) return;
    setLoading(true);

    const [statesRes, actionsRes, checkpointsRes, reviewsRes, integrationRes, nameRes] = await Promise.all([
      supabase.from('computed_states').select('day, score, level, pillars, phase, raw_input')
        .eq('user_id', userId).order('day', { ascending: false }).limit(30),
      supabase.from('action_logs').select('id, action_type, payload, created_at')
        .eq('user_id', userId).eq('day', today),
      supabase.from('checkpoints').select('id, checkpoint_type, data, created_at')
        .eq('user_id', userId).eq('day', today),
      supabase.from('daily_reviews').select('id, day, focus_score, clarity_score, energy_score, mood_score, notes')
        .eq('user_id', userId).order('day', { ascending: false }).limit(7),
      // Wearable integration: anel BLE (qring/jstyle/colmi). Apple Health
      // ficou no banco como legacy mas não é mais exibido (2026-05-16).
      supabase.from('user_integrations').select('provider, status, last_sync_at, scopes')
        .eq('user_id', userId).in('status', ['active', 'connected']).neq('provider', 'apple_health').maybeSingle(),
      supabase.from('participantes').select('nome_publico, onboarding_completo')
        .eq('user_id', userId).maybeSingle(),
    ]);

    // Gate health sync on onboarding: without a completed participantes row we
    // don't want to create user_integrations or pollute biomarker_samples with
    // orphan data. (Fixes the 2 orphan users_ids leaking 677 samples.)
    const onboardingDone = nameRes.data?.onboarding_completo === true;

    // Report app version to participantes (fire-and-forget)
    if (Capacitor.isNativePlatform()) {
      CapApp.getInfo().then(info => {
        const ver = `${info.version}(${info.build})`;
        supabase.from('participantes')
          .update({ app_version: ver })
          .eq('user_id', userId)
          .then(({ error }) => {
            if (error) console.warn('[store] app_version update failed:', error.message);
            else console.info('[store] app_version reported:', ver);
          });
      }).catch(() => {});
    }

    // History
    const history: DayEntry[] = (statesRes.data || []).map((d) => {
      const p = d.pillars as any;
      return {
        day: d.day,
        score: d.score ?? 0,
        level: d.level ?? 'Crítico',
        pillars: { energia: p?.energia ?? 0, clareza: p?.clareza ?? 0, estabilidade: p?.estabilidade ?? 0 },
        phase: d.phase ?? 'BOOT',
      };
    });
    setHistoryByDay(history);

    // Today's state
    let todayEntry = history.find((h) => h.day === today);

    // If no computed state for today, try to compute from ring_daily_data
    if (!todayEntry) {
      try {
        const computed = await computeAndStoreState(today, userId);
        if (computed) {
          todayEntry = {
            day: today,
            score: computed.score,
            level: computed.level,
            pillars: computed.pillars,
            phase: computed.phase,
          };
          setHistoryByDay((prev) => [todayEntry!, ...prev]);
        }
      } catch (err) {
        console.warn('[useVYRStore] Auto-compute failed:', err);
      }
    }

    if (todayEntry) {
      setState({
        score: todayEntry.score,
        level: todayEntry.level,
        pillars: todayEntry.pillars,
        limitingFactor: getLimitingFactor(todayEntry.pillars),
        phase: (todayEntry.phase as VYRState['phase']) || getCurrentPhase(),
      });
      setHasData(true);
      const todayRaw = (statesRes.data || []).find((s: any) => s.day === today);
      if (todayRaw?.raw_input?.data_confidence) setDataConfidence(todayRaw.raw_input.data_confidence);
    }

    // Actions
    if (actionsRes.data) setActionLogs(actionsRes.data);

    // Checkpoints
    if (checkpointsRes.data) setCheckpoints(checkpointsRes.data);

    // Reviews
    if (reviewsRes.data) setDailyReviews(reviewsRes.data);

    // Wearable
    if (integrationRes.data) {
      const connStatus = integrationRes.data.status;
      const isActive = connStatus === 'active' || connStatus === 'connected';

      setWearableConnection({
        provider: integrationRes.data.provider,
        status: connStatus,
        lastSyncAt: integrationRes.data.last_sync_at,
        scopes: integrationRes.data.scopes || [],
      });

      // Auto-reconnect: re-enable background sync + auto-sync if connection was active
      if (isActive && onboardingDone) {
        setConnectionActive(true);
        // Fire-and-forget: bootstrap in background, don't block loadData
        bootstrapHealthSync().then(async (synced) => {
          if (synced) {
            setWearableConnection((prev) =>
              prev ? { ...prev, lastSyncAt: new Date().toISOString() } : prev
            );
            // Reload VYR state — sync may have computed a fresh score
            await refreshStateFromDB();
          }
        });
      } else if (connStatus === 'disconnected') {
        // Was explicitly disconnected by user — do NOT auto-reconnect.
        // User must tap "Connect" again manually to avoid reconnect loops.
        console.info('[useVYRStore] Integration is disconnected, waiting for manual reconnect');
      }
    } else if (onboardingDone) {
      // Sem integração — primeiro uso. Antes auto-conectava Apple Health;
      // removido em 2026-05-16. Usuário pareia anel via RingPairingFlow.
      console.info('[useVYRStore] No wearable integration — user must pair ring via UI');
    } else {
      console.info('[useVYRStore] Skipping: onboarding not completed');
    }

    // Name
    if (nameRes.data?.nome_publico) {
      setUserName(nameRes.data.nome_publico.split(' ')[0]);
    }

    // F6: Load prediction + anomaly from new tables
    if (userId) {
      try {
        const [pred, anom] = await Promise.all([
          loadTomorrowPrediction(userId),
          loadTodayAnomaly(userId),
        ]);
        setPrediction(pred);
        setAnomaly(anom);
      } catch (e) {
        console.warn('[store] prediction/anomaly load failed:', e);
      }
    }

    setLoading(false);
  }, [userId, today, autoConnect, refreshStateFromDB]);

  useEffect(() => {
    loadData();
    // Register Capacitor app lifecycle listeners (resume/pause) once
    setupAppLifecycleListeners(() => {
      // On sync complete after resume, reload data to refresh UI
      loadData();
    });
    // Start listening for admin-triggered sync commands via Realtime
    if (userId) {
      startSyncCommandListener(userId);
    }
    return () => {
      stopSyncCommandListener();
    };
  }, [loadData, userId]);

  // Actions
  const logAction = useCallback(async (phase: string, payload?: object) => {
    const uid = await requireValidUserId();
    await retryOnAuthErrorLabeled(async () => {
      const result = await supabase.from('action_logs').insert({
        user_id: uid,
        day: today,
        action_type: phase,
        payload: { confirmed_at: new Date().toISOString(), ...payload },
      }).select();
      return result;
    }, { table: 'action_logs', operation: 'insert' });
    setActionLogs((prev) => [...prev, {
      id: crypto.randomUUID(),
      action_type: phase,
      payload: payload ?? {},
      created_at: new Date().toISOString(),
    }]);
    setSachetConfirmation({ show: true, phase });
  }, [today]);

  const addCheckpoint = useCallback(async (note: string) => {
    const uid = await requireValidUserId();
    await retryOnAuthErrorLabeled(async () => {
      const result = await supabase.from('checkpoints').insert({
        user_id: uid,
        day: today,
        checkpoint_type: 'observation',
        data: { note, timestamp: new Date().toISOString() },
      }).select();
      return result;
    }, { table: 'checkpoints', operation: 'insert' });
    setCheckpoints((prev) => [...prev, {
      id: crypto.randomUUID(),
      checkpoint_type: 'observation',
      data: { note },
      created_at: new Date().toISOString(),
    }]);
  }, [today]);

  const dismissConfirmation = useCallback(() => {
    setSachetConfirmation({ show: false, phase: '' });
  }, []);

  const activateTransition = useCallback(async (targetPhase: string) => {
    await logAction(targetPhase, { transition: true });
  }, [logAction]);

  /**
   * connectWearable — pós HealthKit removal (2026-05-16).
   * Antes pedia permissão HealthKit + criava row apple_health.
   * Agora delega pareamento ao RingPairingFlow (componente UI dedicado para BLE).
   * Mantém o symbol exportado pra não quebrar Settings.tsx.
   */
  const connectWearable = useCallback(async () => {
    console.info('[useVYRStore] connectWearable: route to RingPairingFlow UI');
    return false;
  }, []);

  const disconnectWearable = useCallback(async () => {
    const uid = await requireValidUserId();
    await retryOnAuthErrorLabeled(async () => {
      const result = await supabase.from('user_integrations')
        .update({ status: 'disconnected' })
        .eq('user_id', uid)
        .in('status', ['active', 'connected'])
        .select();
      return result;
    }, { table: 'user_integrations', operation: 'update' });
    setConnectionActive(false);
    setWearableConnection(null);
  }, []);

  const syncWearable = useCallback(async () => {
    // QRing sync (HealthKit removido 2026-05-16)
    const { runQRingSyncIfPaired } = await import('@/wearables/wearable.sync');
    const summary = await runQRingSyncIfPaired().catch(() => ({ ran: false }));
    const ok = summary.ran;
    if (ok) {
      setWearableConnection((prev) => prev ? { ...prev, lastSyncAt: new Date().toISOString() } : prev);
      await loadData();
    }
    return ok;
  }, [loadData]);

  const actionsTaken = actionLogs.map((a) => a.action_type);

  // Perception tracking — derive which phases have been recorded today
  const perceptionsDone = actionLogs
    .filter((a) => a.action_type.startsWith('perception_'))
    .map((a) => a.action_type.replace('perception_', ''));

  const getPhasePerceptionValues = useCallback((phase: string) => {
    const log = actionLogs.find((a) => a.action_type === `perception_${phase}`);
    return log?.payload?.values as Record<string, number> | undefined;
  }, [actionLogs]);

  const logPerception = useCallback(async (phase: string, values: Record<string, number>) => {
    const uid = await requireValidUserId();
    await retryOnAuthErrorLabeled(async () => {
      const result = await supabase.from('action_logs').insert({
        user_id: uid,
        day: today,
        action_type: `perception_${phase}`,
        payload: { values, recorded_at: new Date().toISOString() },
      }).select();
      return result;
    }, { table: 'action_logs', operation: 'insert' });
    setActionLogs((prev) => [...prev, {
      id: crypto.randomUUID(),
      action_type: `perception_${phase}`,
      payload: { values, recorded_at: new Date().toISOString() },
      created_at: new Date().toISOString(),
    }]);
  }, [today]);

  return {
    state,
    hasData,
    loading,
    historyByDay,
    actionLogs,
    actionsTaken,
    perceptionsDone,
    getPhasePerceptionValues,
    checkpoints,
    dailyReviews,
    wearableConnection,
    sachetConfirmation,
    userName,
    prediction,
    anomaly,
    dataDays,
    dataConfidence,
    engineMode: dataDays < 7 ? 'bootstrap' as const : dataDays < 30 ? 'adaptive' as const : 'ml_ready' as const,
    logAction,
    logPerception,
    addCheckpoint,
    dismissConfirmation,
    activateTransition,
    connectWearable,
    disconnectWearable,
    syncWearable,
    refresh: loadData,
  };
}
