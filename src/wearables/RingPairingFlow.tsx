/**
 * RingPairingFlow — unified onboarding for ring + health permissions.
 *
 * One CTA orchestrates the whole flow: scan ring via BLE → connect → request
 * HealthKit permissions. Both data paths get activated together.
 *
 * Two complementary data paths run after pairing:
 *   1. BLE direct (QRingPlugin) → Supabase + HealthKit. Raw notify bytes
 *      captured for parser improvement; samples written to both stores.
 *   2. HealthKit reads → VYR. Pulls normalized cross-source data (official
 *      ring app, Apple Watch, Garmin, etc.) for VYR State computation.
 *
 * They complement each other: BLE gives high-frequency raw data, HealthKit
 * gives normalized cross-vendor data. Until we standardize ring parsers,
 * HealthKit is the safety net for VYR State.
 */

import { useEffect, useState } from 'react';
import { Bluetooth, Heart, Check, RefreshCw, Unplug, Loader2, AlertCircle } from 'lucide-react';
import { qringStore, type QRingDevice } from './qring/qring.store';
import { useVYRStore } from '@/hooks/useVYRStore';
import { toast } from 'sonner';

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

  const ringStore = qringStore.getState();
  const vyr = useVYRStore();
  const { wearableConnection, connectWearable, disconnectWearable, syncWearable } = vyr;

  // Subscribe to ring store changes
  useEffect(() => qringStore.subscribe(() => forceUpdate((n) => n + 1)), []);

  // Auto-advance: when ring becomes connected during 'connecting-ring', go to health
  useEffect(() => {
    if (step === 'connecting-ring' && ringStore.connectedDevice) {
      void runHealthStep();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, ringStore.connectedDevice]);

  // Auto-stop scan after timeout
  useEffect(() => {
    if (step !== 'scanning') return;
    const t = setTimeout(() => {
      // If still scanning and we have devices, advance to picking; else error
      const s = qringStore.getState();
      if (s.devices.length > 0) {
        void qringStore.stopScan();
        setStep('picking');
      } else {
        void qringStore.stopScan();
        setStep('error');
        setErrorMsg('Nenhum anel encontrado. Verifique se o anel está ligado e próximo.');
      }
    }, SCAN_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [step]);

  const ringConnected = !!ringStore.connectedDevice;
  const healthActive = wearableConnection?.status === 'active' || wearableConnection?.status === 'connected';
  const fullyOnboarded = ringConnected && healthActive;

  // ---- Flow steps ----

  async function startFlow() {
    setErrorMsg(null);
    setStep('scanning');
    const ok = await qringStore.scan();
    if (!ok) {
      setStep('error');
      setErrorMsg('Bluetooth indisponível. Habilite o Bluetooth nos ajustes.');
    }
  }

  async function pickDevice(deviceId: string) {
    setStep('connecting-ring');
    const ok = await qringStore.connect(deviceId);
    if (!ok) {
      setStep('error');
      setErrorMsg('Não conseguimos conectar ao anel. Tente novamente.');
    }
    // success → useEffect transitions to runHealthStep
  }

  async function runHealthStep() {
    setStep('requesting-health');
    const hkOk = await connectWearable();
    if (!hkOk) {
      // Ring is connected but HealthKit denied/unavailable. We still consider
      // the flow successful — BLE path runs alone. User can retry HK later.
      toast.info('Apple Health não foi liberado. Você pode liberar depois nos ajustes.');
      setStep('done');
      return;
    }
    // First sync (HK incremental) already runs inside connectWearable.
    // Now also run a BLE sync so we have parity from minute one.
    setStep('syncing-first');
    try {
      await qringStore.sync();
    } catch (e) {
      // BLE sync may fail silently for many reasons (ring busy, range) —
      // not fatal for the onboarding completion.
      console.warn('[ring-pairing] First BLE sync failed:', (e as Error)?.message);
    }
    setStep('done');
    toast.success('Anel + Apple Health conectados');
  }

  async function handleSyncAll() {
    setSyncing(true);
    const [bleOk, hkOk] = await Promise.all([
      qringStore.sync().then(() => true).catch(() => false),
      syncWearable().catch(() => false),
    ]);
    setSyncing(false);
    if (bleOk && hkOk) toast.success('Sincronizado: anel + Apple Health');
    else if (bleOk) toast.info('Anel sincronizado, Apple Health falhou');
    else if (hkOk) toast.info('Apple Health sincronizado, anel falhou');
    else toast.error('Falha na sincronização');
  }

  async function handleDisconnect() {
    await Promise.all([qringStore.disconnect(), disconnectWearable()]);
    setStep('idle');
    toast.success('Desconectado');
  }

  // ---- Render ----

  // FULLY CONNECTED — status card with both paths
  if (fullyOnboarded) {
    return <ConnectedCard
      device={ringStore.connectedDevice!}
      battery={ringStore.battery}
      lastSyncAt={wearableConnection?.lastSyncAt ?? ringStore.lastSyncAt}
      onSync={handleSyncAll}
      onDisconnect={handleDisconnect}
      syncing={syncing}
    />;
  }

  // PARTIAL — only one path is active
  if (ringConnected || healthActive) {
    return <PartialCard
      device={ringStore.connectedDevice}
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

  // IDLE / IN-PROGRESS — onboarding card
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
            <span className="text-foreground font-medium">Anel via Bluetooth</span> — coleta direta de FC, HRV, SpO₂, passos e temperatura, sem depender do app oficial do anel.
          </p>
        </div>
        <div className="flex items-start gap-2">
          <Heart size={14} className="text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <span className="text-foreground font-medium">Apple Health</span> — calcula seu VYR State usando dados normalizados de qualquer fonte (anel, Apple Watch, Garmin).
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
          <p className="text-[11px] text-muted-foreground">Encontramos {ringStore.devices.length} dispositivo{ringStore.devices.length === 1 ? '' : 's'}. Selecione seu anel:</p>
          {ringStore.devices.map((d) => (
            <button
              key={d.deviceId}
              onClick={() => pickDevice(d.deviceId)}
              className="w-full flex items-center justify-between rounded-xl border border-border p-3 transition-all active:scale-[0.98] hover:bg-muted/40"
            >
              <div className="text-left">
                <p className="text-xs font-medium text-foreground">
                  {d.name}
                  {d.saved && <span className="text-[10px] text-muted-foreground ml-1">(salvo)</span>}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {d.rssi != null && d.rssi !== 0 && `${d.rssi} dBm · `}{d.model}
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
  device: QRingDevice;
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
  device: QRingDevice | null;
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
