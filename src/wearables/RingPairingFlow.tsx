/**
 * RingPairingFlow — unified onboarding for ring + health permissions.
 *
 * One CTA orchestrates the whole flow: scan ring via BLE → connect → request
 * HealthKit permissions. Both data paths get activated together.
 *
 * Two complementary data paths run after pairing:
 *   1. BLE direct (QRingPlugin → wearableStore → ingest-biomarker-batch).
 *      Raw notify bytes captured for parser improvement; samples written to
 *      Supabase + HealthKit (hybrid forward in wearable.sync.ts).
 *   2. HealthKit reads → VYR. Pulls normalized cross-source data (official
 *      ring app, Apple Watch, Garmin, etc.) for VYR State computation.
 */

import { useEffect, useState } from 'react';
import { Bluetooth, Heart, Check, RefreshCw, Unplug, Loader2, AlertCircle } from 'lucide-react';
import { wearableStore } from './wearable.store';
import {
  flushSamplesToBackend,
  rememberPairedQRing,
  forgetPairedQRing,
} from './wearable.sync';
import { useVYRStore } from '@/hooks/useVYRStore';
import { toast } from 'sonner';
import type { WearableDevice } from './jstyle/wearable.types';

type FlowStep =
  | 'idle'
  | 'scanning'
  | 'picking'
  | 'connecting-ring'
  | 'requesting-health'
  | 'syncing-first'
  | 'done'
  | 'error';

const SCAN_TIMEOUT_MS = 8000;

export default function RingPairingFlow() {
  const [, forceUpdate] = useState(0);
  const [step, setStep] = useState<FlowStep>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const ringState = wearableStore.getState();
  const vyr = useVYRStore();
  const { wearableConnection, connectWearable, disconnectWearable, syncWearable } = vyr;

  useEffect(() => wearableStore.subscribe(() => forceUpdate((n) => n + 1)), []);

  // Auto-advance: when ring becomes connected during 'connecting-ring', go to health
  useEffect(() => {
    if (step === 'connecting-ring' && ringState.connectedDevice) {
      void runHealthStep();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, ringState.connectedDevice]);

  // Auto-stop scan after timeout
  useEffect(() => {
    if (step !== 'scanning') return;
    const t = setTimeout(() => {
      const s = wearableStore.getState();
      if (s.devices.length > 0) {
        void wearableStore.stopScan();
        setStep('picking');
      } else {
        void wearableStore.stopScan();
        setStep('error');
        setErrorMsg('Nenhum anel encontrado. Verifique se o anel está ligado e próximo.');
      }
    }, SCAN_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [step]);

  const ringConnected = !!ringState.connectedDevice;
  const healthActive = wearableConnection?.status === 'active' || wearableConnection?.status === 'connected';
  const fullyOnboarded = ringConnected && healthActive;

  // ---- Flow steps ----

  async function startFlow() {
    setErrorMsg(null);
    setStep('scanning');
    try {
      await wearableStore.scan();
    } catch {
      setStep('error');
      setErrorMsg('Bluetooth indisponível. Habilite o Bluetooth nos ajustes.');
    }
  }

  async function pickDevice(deviceId: string) {
    setStep('connecting-ring');
    const ok = await wearableStore.connect(deviceId);
    if (!ok) {
      setStep('error');
      setErrorMsg('Não conseguimos conectar ao anel. Tente novamente.');
      return;
    }
    // Persist deviceId to localStorage so admin-triggered syncs can find it
    // via runQRingSyncIfPaired() (caminho compartilhado, evita "no_paired_device").
    const dev = wearableStore.getState().connectedDevice;
    if (dev) rememberPairedQRing(dev.deviceId, dev.name);
    // Drain workaround: force the ring to record HR every 5 min (vs default
    // 30 min). Faster accumulation = more chances of VYR catching samples
    // before the official QRing app drains the ring on its next sync.
    try {
      await wearableStore.adapter.configureAutoHR(5, true);
    } catch (e) {
      console.warn('[ring-pairing] configureAutoHR failed (non-fatal):', (e as Error)?.message);
    }
    // useEffect transitions to runHealthStep
  }

  async function runHealthStep() {
    setStep('requesting-health');
    const hkOk = await connectWearable();
    if (!hkOk) {
      // Ring is connected but HealthKit denied/unavailable. We still consider
      // the flow successful — BLE path runs alone. User can retry HK later.
      toast.info('Apple Health não foi liberado. Você pode liberar depois nos ajustes.');
      // Run a first BLE sync anyway so we have something to work with
      await runFirstBleSync();
      setStep('done');
      return;
    }
    // First sync (HK incremental) already runs inside connectWearable.
    // Now also run a BLE sync + flush so amostras chegam ao banco.
    setStep('syncing-first');
    await runFirstBleSync();
    setStep('done');
    toast.success('Anel + Apple Health conectados');
  }

  /** Runs a BLE sync via wearableStore (which accumulates samples in
   *  pendingSamples), then immediately flushes to Supabase via the edge
   *  function. Best-effort — failures don't block onboarding completion. */
  async function runFirstBleSync(): Promise<void> {
    try {
      await wearableStore.sync();
      const total = Array.from(wearableStore.getState().pendingSamples.values())
        .reduce((sum, arr) => sum + arr.length, 0);
      if (total > 0) {
        await flushSamplesToBackend();
      }
    } catch (e) {
      console.warn('[ring-pairing] First BLE sync failed:', (e as Error)?.message);
    }
  }

  async function handleSyncAll() {
    setSyncing(true);
    let bleOk = false;
    let hkOk = false;
    // BLE sync — pendingSamples gets populated, then flush to backend
    try {
      await wearableStore.sync();
      const total = Array.from(wearableStore.getState().pendingSamples.values())
        .reduce((sum, arr) => sum + arr.length, 0);
      if (total > 0) {
        await flushSamplesToBackend();
      }
      bleOk = true;
    } catch (e) {
      console.warn('[ring-pairing] BLE sync failed:', (e as Error)?.message);
    }
    // HealthKit sync — uses VYR store flow (also recomputes state)
    try {
      hkOk = await syncWearable();
    } catch {
      hkOk = false;
    }
    setSyncing(false);
    if (bleOk && hkOk) toast.success('Sincronizado: anel + Apple Health');
    else if (bleOk) toast.info('Anel sincronizado, Apple Health falhou');
    else if (hkOk) toast.info('Apple Health sincronizado, anel falhou');
    else toast.error('Falha na sincronização');
  }

  async function handleDisconnect() {
    forgetPairedQRing();
    await Promise.all([wearableStore.disconnect(), disconnectWearable()]);
    setStep('idle');
    toast.success('Desconectado');
  }

  // ---- Render ----

  if (fullyOnboarded) {
    return <ConnectedCard
      device={ringState.connectedDevice!}
      battery={ringState.diagnostics?.battery ?? null}
      lastSyncAt={wearableConnection?.lastSyncAt ?? ringState.lastSyncAt}
      onSync={handleSyncAll}
      onDisconnect={handleDisconnect}
      syncing={syncing}
    />;
  }

  if (ringConnected || healthActive) {
    return <PartialCard
      device={ringState.connectedDevice}
      ringConnected={ringConnected}
      healthActive={healthActive}
      onCompleteHealth={runHealthStep}
      onCompleteRing={startFlow}
      onSync={handleSyncAll}
      onDisconnect={handleDisconnect}
      syncing={syncing}
      step={step}
    />;
  }

  return (
    <div className="rounded-2xl bg-card border border-border p-4 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'hsl(var(--vyr-accent-stable) / 0.15)' }}>
          <Bluetooth size={20} style={{ color: 'hsl(var(--vyr-accent-stable))' }} />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">Conectar seu anel ao VYR</h3>
          <p className="text-xs text-muted-foreground">Bluetooth + Apple Health em uma única autorização</p>
        </div>
      </div>

      <div className="rounded-xl bg-muted/40 p-3 space-y-2">
        <div className="flex items-start gap-2">
          <Bluetooth size={14} className="text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <span className="text-foreground font-medium">Anel via Bluetooth</span> — coleta direta de FC, HRV, SpO₂, passos e temperatura.
          </p>
        </div>
        <div className="flex items-start gap-2">
          <Heart size={14} className="text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <span className="text-foreground font-medium">Apple Health</span> — calcula seu VYR State usando dados normalizados de qualquer fonte (anel, Apple Watch, Garmin).
          </p>
        </div>
        <div className="flex items-start gap-2 pt-1">
          <AlertCircle size={12} className="text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Se você usa o app oficial do anel, ele drena os dados a cada sincronização. Pra dados brutos completos via Bluetooth no VYR, mantenha o app oficial fechado entre uma sync e outra.
          </p>
        </div>
      </div>

      {step === 'idle' && (
        <button
          onClick={startFlow}
          className="w-full rounded-xl font-medium py-3.5 text-sm text-white transition-all active:scale-[0.98]"
          style={{ background: 'hsl(var(--vyr-accent-stable))' }}
        >
          Conectar agora
        </button>
      )}

      {step === 'scanning' && (
        <div className="flex flex-col items-center gap-2 py-2">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Procurando seu anel próximo...</p>
        </div>
      )}

      {step === 'picking' && (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">Encontramos {ringState.devices.length} dispositivo{ringState.devices.length === 1 ? '' : 's'}. Selecione seu anel:</p>
          {ringState.devices.map((d) => (
            <button
              key={d.deviceId}
              onClick={() => pickDevice(d.deviceId)}
              className="w-full flex items-center justify-between rounded-xl border border-border p-3 transition-all active:scale-[0.98] hover:bg-muted/40"
            >
              <div className="text-left">
                <p className="text-xs font-medium text-foreground">
                  {d.name}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {d.model}
                </p>
              </div>
              <span className="text-xs font-medium" style={{ color: 'hsl(var(--vyr-accent-stable))' }}>
                Conectar
              </span>
            </button>
          ))}
        </div>
      )}

      {step === 'connecting-ring' && (
        <div className="flex flex-col items-center gap-2 py-2">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Conectando ao anel...</p>
        </div>
      )}

      {step === 'requesting-health' && (
        <div className="flex flex-col items-center gap-2 py-2">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Liberando Apple Health...</p>
          <p className="text-[10px] text-muted-foreground">Aceite as permissões no diálogo do sistema.</p>
        </div>
      )}

      {step === 'syncing-first' && (
        <div className="flex flex-col items-center gap-2 py-2">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Primeira sincronização...</p>
        </div>
      )}

      {step === 'error' && (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3">
            <AlertCircle size={14} className="text-destructive mt-0.5 shrink-0" />
            <p className="text-[11px] text-destructive leading-relaxed">{errorMsg}</p>
          </div>
          <button
            onClick={startFlow}
            className="w-full rounded-xl border border-border font-medium py-3 text-sm text-foreground transition-all active:scale-[0.98]"
          >
            Tentar novamente
          </button>
        </div>
      )}
    </div>
  );
}

// ---- Sub-components ----

function ConnectedCard({
  device,
  battery,
  lastSyncAt,
  onSync,
  onDisconnect,
  syncing,
}: {
  device: WearableDevice;
  battery: number | null;
  lastSyncAt: string | null;
  onSync: () => void;
  onDisconnect: () => void;
  syncing: boolean;
}) {
  const lastSyncStr = lastSyncAt
    ? new Date(lastSyncAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="rounded-2xl bg-card border border-border p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'hsl(var(--vyr-accent-stable) / 0.15)' }}>
          <Check size={20} style={{ color: 'hsl(var(--vyr-accent-stable))' }} />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">Conectado</h3>
          <p className="text-xs text-muted-foreground">{device.name} · Apple Health ativo</p>
        </div>
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
          style={{ background: 'hsl(var(--vyr-accent-stable) / 0.15)', color: 'hsl(var(--vyr-accent-stable))' }}>
          Ativo
        </span>
      </div>

      <div className="rounded-xl bg-muted/30 p-3 space-y-1.5">
        <StatusLine label="Anel BLE" detail={`${device.name}${battery != null && battery >= 0 ? ` · ${battery}%` : ''}`} />
        <StatusLine label="Apple Health" detail="Sincronizando" />
        {lastSyncStr && <StatusLine label="Última sync" detail={lastSyncStr} />}
      </div>

      <div className="flex gap-2">
        <button
          onClick={onSync}
          disabled={syncing}
          className="flex-1 rounded-xl border border-border py-2.5 text-xs font-medium text-foreground flex items-center justify-center gap-1.5 active:scale-[0.98] disabled:opacity-50"
        >
          <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Sincronizando...' : 'Sincronizar tudo'}
        </button>
        <button
          onClick={onDisconnect}
          className="rounded-xl border border-border py-2.5 px-4 text-xs text-destructive flex items-center gap-1.5 active:scale-[0.98]"
        >
          <Unplug size={14} />
          Desconectar
        </button>
      </div>
    </div>
  );
}

function PartialCard({
  device,
  ringConnected,
  healthActive,
  onCompleteHealth,
  onCompleteRing,
  onSync,
  onDisconnect,
  syncing,
  step,
}: {
  device: WearableDevice | null;
  ringConnected: boolean;
  healthActive: boolean;
  onCompleteHealth: () => void;
  onCompleteRing: () => void;
  onSync: () => void;
  onDisconnect: () => void;
  syncing: boolean;
  step: FlowStep;
}) {
  const missing = ringConnected ? 'Apple Health' : 'Anel';
  const inProgress = step === 'requesting-health' || step === 'scanning' || step === 'connecting-ring';

  return (
    <div className="rounded-2xl bg-card border border-border p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'hsl(var(--vyr-accent-transition) / 0.15)' }}>
          <AlertCircle size={20} style={{ color: 'hsl(var(--vyr-accent-transition))' }} />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">Conexão parcial</h3>
          <p className="text-xs text-muted-foreground">Falta liberar {missing}</p>
        </div>
      </div>

      <div className="rounded-xl bg-muted/30 p-3 space-y-1.5">
        <StatusLine label="Anel BLE" detail={ringConnected ? device?.name ?? 'conectado' : 'não conectado'} ok={ringConnected} />
        <StatusLine label="Apple Health" detail={healthActive ? 'ativo' : 'não liberado'} ok={healthActive} />
      </div>

      <button
        onClick={ringConnected ? onCompleteHealth : onCompleteRing}
        disabled={inProgress}
        className="w-full rounded-xl font-medium py-3 text-sm text-white transition-all active:scale-[0.98] disabled:opacity-50"
        style={{ background: 'hsl(var(--vyr-accent-stable))' }}
      >
        {inProgress ? 'Aguarde...' : `Liberar ${missing}`}
      </button>

      <div className="flex gap-2">
        <button
          onClick={onSync}
          disabled={syncing}
          className="flex-1 rounded-xl border border-border py-2.5 text-xs font-medium text-foreground flex items-center justify-center gap-1.5 active:scale-[0.98] disabled:opacity-50"
        >
          <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Sincronizando...' : 'Sincronizar'}
        </button>
        <button
          onClick={onDisconnect}
          className="rounded-xl border border-border py-2.5 px-4 text-xs text-destructive flex items-center gap-1.5 active:scale-[0.98]"
        >
          <Unplug size={14} />
        </button>
      </div>
    </div>
  );
}

function StatusLine({ label, detail, ok = true }: { label: string; detail: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={ok ? 'text-foreground' : 'text-destructive'}>{detail}</span>
    </div>
  );
}
