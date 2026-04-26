/**
 * QRingModule — BLE scanner and connection UI for QRing (Colmi R02) on iOS.
 */

import { useState, useEffect } from 'react';
import { Bluetooth, Loader2, RefreshCw, Unplug, Info, Battery, Wifi } from 'lucide-react';
import { qringStore } from './qring.store';
import { toast } from 'sonner';

export default function QRingModule() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    return qringStore.subscribe(() => forceUpdate((n) => n + 1));
  }, []);

  const state = qringStore.getState();
  const { status, devices, connectedDevice, battery, lastSyncAt, syncProgress } = state;
  const isScanning = status === 'scanning';
  const isSyncing = status === 'syncing';

  const handleScan = async () => {
    if (isScanning) {
      qringStore.stopScan();
    } else {
      const ok = await qringStore.scan();
      if (!ok) toast.error('Bluetooth não disponível');
    }
  };

  const handleConnect = async (id: string) => {
    const ok = await qringStore.connect(id);
    if (ok) toast.success('QRing conectado');
    else toast.error('Falha ao conectar ao QRing');
  };

  const handleDisconnect = () => {
    qringStore.disconnect();
    toast.success('QRing desconectado');
  };

  const handleSync = async () => {
    const ok = await qringStore.sync();
    if (ok) toast.success('Dados sincronizados via BLE');
    else toast.error('Falha na sincronização BLE');
  };

  return (
    <div className="rounded-2xl bg-card border border-border p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'hsl(var(--vyr-accent-stable) / 0.15)' }}>
          <Bluetooth size={20} style={{ color: 'hsl(var(--vyr-accent-stable))' }} />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">QRing (Bluetooth Direto)</h3>
          <p className="text-xs text-muted-foreground">
            {connectedDevice
              ? `Conectado: ${connectedDevice.name}`
              : isScanning
                ? 'Procurando...'
                : 'Não conectado'}
          </p>
        </div>
        {connectedDevice && (
          <span
            className="text-[10px] font-medium px-2 py-0.5 rounded-full"
            style={{ background: 'hsl(var(--vyr-accent-stable) / 0.15)', color: 'hsl(var(--vyr-accent-stable))' }}
          >
            Ativo
          </span>
        )}
      </div>

      {/* Battery + last sync info */}
      {connectedDevice && (
        <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
          {battery != null && battery >= 0 && (
            <span className="flex items-center gap-1">
              <Battery size={12} /> {battery}%
            </span>
          )}
          {lastSyncAt && (
            <span>
              Última sync: {new Date(lastSyncAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      )}

      {/* Sync progress */}
      {isSyncing && syncProgress && (
        <p className="text-[11px] text-muted-foreground animate-pulse">{syncProgress}</p>
      )}

      {/* Permissions hint */}
      {!connectedDevice && !isScanning && (
        <div className="flex items-start gap-2 rounded-xl bg-muted/50 p-3">
          <Info size={14} className="text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Conecte o anel diretamente via Bluetooth. Funciona mesmo com o app nativo do anel aberto.
          </p>
        </div>
      )}

      {/* Scan button */}
      {!connectedDevice && (
        <button
          onClick={handleScan}
          className="w-full rounded-xl font-medium py-3 text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform text-white"
          style={{ background: 'hsl(var(--vyr-accent-stable))' }}
        >
          {isScanning && <Loader2 size={16} className="animate-spin" />}
          {isScanning ? 'Parar busca' : 'Procurar QRing'}
        </button>
      )}

      {/* Device list */}
      {!connectedDevice && devices.length > 0 && (
        <div className="space-y-2">
          {devices.map((d) => (
            <div key={d.deviceId} className="flex items-center justify-between rounded-xl border border-border p-3">
              <div>
                <p className="text-xs font-medium text-foreground">
                  {d.name}
                  {d.saved && <span className="text-[10px] text-muted-foreground ml-1">(salvo)</span>}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {d.mac ?? d.deviceId}
                  {d.rssi != null && d.rssi !== 0 && ` · ${d.rssi} dBm`}
                </p>
              </div>
              <button
                onClick={() => handleConnect(d.deviceId)}
                className="text-xs font-medium px-3 py-1.5 rounded-lg active:scale-[0.97]"
                style={{ background: 'hsl(var(--vyr-accent-stable) / 0.1)', color: 'hsl(var(--vyr-accent-stable))' }}
              >
                Conectar
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Connected actions */}
      {connectedDevice && (
        <div className="flex gap-2">
          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="flex-1 rounded-xl border border-border py-2.5 text-xs font-medium text-foreground flex items-center justify-center gap-1.5 active:scale-[0.98] disabled:opacity-50"
          >
            <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
            {isSyncing ? 'Sincronizando...' : 'Sync BLE'}
          </button>
          <button
            onClick={handleDisconnect}
            className="rounded-xl border border-border py-2.5 px-4 text-xs text-destructive flex items-center gap-1.5 active:scale-[0.98]"
          >
            <Unplug size={14} />
            Desconectar
          </button>
        </div>
      )}
    </div>
  );
}
