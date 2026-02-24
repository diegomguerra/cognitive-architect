/**
 * WearableModule — Main wearable integration screen (production).
 * Feature-flagged: only renders if JSTYLE_ENABLED.
 */

import { useState, useEffect } from 'react';
import { Bluetooth, Loader2, RefreshCw, Check, AlertCircle, Unplug, Info } from 'lucide-react';
import { wearableStore } from './wearable.store';
import { flushSamplesToBackend } from './wearable.sync';
import { isDebugEnabled } from './wearable.telemetry';
import type { BiomarkerType, SyncProgress } from './wearable.types';
import { toast } from 'sonner';

const BIOMARKER_LABELS: Record<BiomarkerType, string> = {
  sleep: 'Sono',
  hrv: 'HRV',
  spo2: 'SpO₂',
  temp: 'Temperatura',
  steps: 'Passos',
  hr: 'Frequência Cardíaca',
};

export default function WearableModule() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    return wearableStore.subscribe(() => forceUpdate((n) => n + 1));
  }, []);

  const enabled = import.meta.env.VITE_JSTYLE_ENABLED !== 'false';
  if (!enabled) return null;

  const state = wearableStore.getState();
  const { status, devices, connectedDevice, syncProgress, diagnostics, lastSyncAt } = state;

  const isScanning = status === 'scanning';
  const isSyncing = status === 'syncing';
  const allDone = Array.from(syncProgress.values()).every((p) => p.status === 'done');
  const hasData = Array.from(syncProgress.values()).some((p) => (p.count ?? 0) > 0);

  const handleScan = () => isScanning ? wearableStore.stopScan() : wearableStore.scan();
  const handleConnect = async (id: string) => {
    const ok = await wearableStore.connect(id);
    if (!ok) toast.error('Falha ao conectar ao dispositivo');
  };
  const handleDisconnect = () => wearableStore.disconnect();
  const handleSync = () => wearableStore.sync();
  const handleFlush = async () => {
    const result = await flushSamplesToBackend();
    if (result) {
      toast.success(`${result.inserted} amostras enviadas, ${result.duplicates} duplicatas ignoradas`);
    } else {
      toast.error('Nenhuma amostra para enviar');
    }
  };

  return (
    <div className="space-y-4">
      {/* --- Scanner / Connection --- */}
      <div className="rounded-2xl bg-card border border-border p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
            <Bluetooth size={20} className="text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-foreground">J-Style Ring X3</h3>
            <p className="text-xs text-muted-foreground">
              {connectedDevice
                ? `Conectado: ${connectedDevice.name}`
                : isScanning
                  ? 'Procurando…'
                  : 'Não conectado'}
            </p>
          </div>
          {connectedDevice && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/15 text-primary">
              Ativo
            </span>
          )}
        </div>

        {lastSyncAt && (
          <p className="text-[10px] text-muted-foreground">
            Última sincronização: {new Date(lastSyncAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
          </p>
        )}

        {/* Permissions hint (iOS) */}
        {!connectedDevice && !isScanning && (
          <div className="flex items-start gap-2 rounded-xl bg-muted/50 p-3">
            <Info size={14} className="text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Para conectar o anel, o app precisará de permissão Bluetooth. No iOS, aceite a solicitação quando aparecer.
            </p>
          </div>
        )}

        {/* Scan button */}
        {!connectedDevice && (
          <button
            onClick={handleScan}
            className="w-full rounded-xl bg-primary text-primary-foreground font-medium py-3 text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
          >
            {isScanning && <Loader2 size={16} className="animate-spin" />}
            {isScanning ? 'Parar busca' : 'Procurar dispositivos'}
          </button>
        )}

        {/* Device list */}
        {!connectedDevice && devices.length > 0 && (
          <div className="space-y-2">
            {devices.map((d) => (
              <div key={d.deviceId} className="flex items-center justify-between rounded-xl border border-border p-3">
                <div>
                  <p className="text-xs font-medium text-foreground">{d.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {d.mac ?? d.deviceId}
                    {d.rssi != null && ` · ${d.rssi} dBm`}
                  </p>
                </div>
                <button
                  onClick={() => handleConnect(d.deviceId)}
                  className="text-xs font-medium text-primary px-3 py-1.5 rounded-lg bg-primary/10 active:scale-[0.97]"
                >
                  Conectar
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Connected: disconnect */}
        {connectedDevice && (
          <button
            onClick={handleDisconnect}
            className="w-full rounded-xl border border-border py-2.5 text-xs text-destructive font-medium flex items-center justify-center gap-1.5 active:scale-[0.98]"
          >
            <Unplug size={14} />
            Desconectar
          </button>
        )}
      </div>

      {/* --- Sync Panel --- */}
      {connectedDevice && (
        <div className="rounded-2xl bg-card border border-border p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Sincronização</h3>

          {syncProgress.size > 0 && (
            <div className="space-y-1.5">
              {Array.from(syncProgress.entries()).map(([type, prog]) => (
                <div key={type} className="flex items-center gap-2">
                  {prog.status === 'syncing' && <Loader2 size={14} className="animate-spin text-primary" />}
                  {prog.status === 'done' && <Check size={14} className="text-primary" />}
                  {prog.status === 'error' && <AlertCircle size={14} className="text-destructive" />}
                  {prog.status === 'pending' && <div className="w-3.5 h-3.5 rounded-full border border-border" />}
                  <span className="text-xs text-foreground flex-1">{BIOMARKER_LABELS[type]}</span>
                  {prog.count != null && prog.count > 0 && (
                    <span className="text-[10px] text-muted-foreground">{prog.count}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleSync}
              disabled={isSyncing}
              className="flex-1 rounded-xl border border-border py-2.5 text-xs font-medium text-foreground flex items-center justify-center gap-1.5 active:scale-[0.98] disabled:opacity-50"
            >
              <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
              {isSyncing ? 'Sincronizando…' : 'Sincronizar agora'}
            </button>

            {allDone && hasData && (
              <button
                onClick={handleFlush}
                className="rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-xs font-medium active:scale-[0.98]"
              >
                Enviar
              </button>
            )}
          </div>
        </div>
      )}

      {/* --- Diagnostics (debug only) --- */}
      {isDebugEnabled() && diagnostics && (
        <div className="rounded-2xl bg-card border border-border p-4 space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Diagnósticos (DEBUG)</h3>
          {[
            { label: 'Device UID', value: diagnostics.deviceId },
            { label: 'MAC', value: diagnostics.mac ?? '—' },
            { label: 'Firmware', value: diagnostics.fwVersion ?? '—' },
            { label: 'Bateria', value: diagnostics.battery != null ? `${diagnostics.battery}%` : '—' },
            { label: 'Último erro', value: diagnostics.lastError ?? 'Nenhum' },
            { label: 'Último sync', value: lastSyncAt ?? '—' },
          ].map((r) => (
            <div key={r.label} className="flex justify-between text-xs">
              <span className="text-muted-foreground">{r.label}</span>
              <span className="text-foreground font-mono text-[11px]">{r.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
