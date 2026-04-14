/**
 * QRingPanel — Minimal UI for pairing + syncing a Colmi R02/R03/R06 ring
 * directly via BLE. Lives inside the iOS app.
 *
 * Flow:
 *   1. User taps "Procurar dispositivos" → QRingAdapter starts BLE scan
 *   2. Rings nearby appear in a list → user taps "Conectar"
 *   3. Once connected, user taps "Sincronizar" → plugin runs full protocol
 *      sequence (SetTime, Battery, HR, Steps, Sleep, SpO2, Stress, HRV)
 *   4. On sync end the React layer flushes pending samples to Supabase via
 *      `ingest-biomarker-batch` edge function.
 */

import { useEffect, useState } from 'react';
import { Circle, Loader2, Unplug, RefreshCw } from 'lucide-react';
import { wearableStore } from './wearable.store';
import { flushSamplesToBackend } from './wearable.sync';
import { toast } from 'sonner';

export default function QRingPanel() {
  const [, force] = useState(0);

  useEffect(() => wearableStore.subscribe(() => force((n) => n + 1)), []);

  const state = wearableStore.getState();
  const { status, devices, connectedDevice, lastSyncAt, syncProgress } = state;
  const isScanning = status === 'scanning';
  const isSyncing = status === 'syncing';

  const handleScan = () =>
    isScanning ? wearableStore.stopScan() : wearableStore.scan();

  const handleConnect = async (id: string) => {
    const ok = await wearableStore.connect(id);
    if (!ok) toast.error('Falha ao conectar ao QRing');
  };

  const handleDisconnect = () => wearableStore.disconnect();

  const handleSync = async () => {
    try {
      await wearableStore.sync();
      const r = await flushSamplesToBackend();
      if (r?.inserted && r.inserted > 0) {
        toast.success(`${r.inserted} amostras sincronizadas`);
      } else if (r) {
        toast(`${r.duplicates} amostras já existentes`);
      }
    } catch (e: any) {
      toast.error(`Falha ao sincronizar: ${e?.message ?? 'erro'}`);
    }
  };

  const totals = Array.from(syncProgress.values()).reduce(
    (a, p) => a + (p.count ?? 0),
    0,
  );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-card border border-border p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
            <Circle size={20} className="text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-foreground">QRing (Colmi R02/R06)</h3>
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
            Última sincronização:{' '}
            {new Date(lastSyncAt).toLocaleString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        )}

        {!connectedDevice && (
          <button
            onClick={handleScan}
            className="w-full rounded-xl bg-primary text-primary-foreground font-medium py-3 text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
          >
            {isScanning && <Loader2 size={16} className="animate-spin" />}
            {isScanning ? 'Parar busca' : 'Procurar dispositivos'}
          </button>
        )}

        {!connectedDevice && devices.length > 0 && (
          <div className="space-y-2">
            {devices.map((d) => (
              <div
                key={d.deviceId}
                className="flex items-center justify-between rounded-xl border border-border p-3"
              >
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

        {connectedDevice && (
          <div className="flex gap-2">
            <button
              onClick={handleSync}
              disabled={isSyncing}
              className="flex-1 rounded-xl bg-primary text-primary-foreground font-medium py-2.5 text-xs flex items-center justify-center gap-1.5 active:scale-[0.98] disabled:opacity-60"
            >
              {isSyncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {isSyncing ? 'Sincronizando…' : 'Sincronizar'}
            </button>
            <button
              onClick={handleDisconnect}
              className="rounded-xl border border-border py-2.5 px-3 text-xs text-destructive font-medium flex items-center justify-center gap-1 active:scale-[0.98]"
            >
              <Unplug size={14} />
            </button>
          </div>
        )}

        {connectedDevice && syncProgress.size > 0 && (
          <div className="rounded-xl bg-muted/40 p-2 text-[11px] text-muted-foreground">
            <div className="font-medium mb-1">
              {totals} amostras recebidas
            </div>
            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
              {Array.from(syncProgress.entries()).map(([type, p]) => (
                <span key={type}>
                  {type}: {p.count ?? 0}
                  {p.status === 'done' ? ' ✓' : ''}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
