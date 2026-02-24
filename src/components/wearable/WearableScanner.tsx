import { Bluetooth, Loader2 } from 'lucide-react';
import type { WearableDevice, WearableConnectionStatus } from '@/lib/wearable/types';

interface Props {
  status: WearableConnectionStatus;
  devices: WearableDevice[];
  connectedDevice: WearableDevice | null;
  onScan: () => void;
  onStopScan: () => void;
  onConnect: (deviceId: string) => void;
  onDisconnect: () => void;
}

export default function WearableScanner({
  status,
  devices,
  connectedDevice,
  onScan,
  onStopScan,
  onConnect,
  onDisconnect,
}: Props) {
  const isScanning = status === 'scanning';

  return (
    <div className="rounded-2xl bg-card border border-border p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
          <Bluetooth size={20} className="text-white" />
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

      {/* Scan button */}
      {!connectedDevice && (
        <button
          onClick={isScanning ? onStopScan : onScan}
          className="w-full rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-medium py-3 text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
        >
          {isScanning && <Loader2 size={16} className="animate-spin" />}
          {isScanning ? 'Parar busca' : 'Procurar dispositivos'}
        </button>
      )}

      {/* Device list */}
      {!connectedDevice && devices.length > 0 && (
        <div className="space-y-2">
          {devices.map((d) => (
            <div
              key={d.deviceId}
              className="flex items-center justify-between rounded-xl border border-border p-3"
            >
              <div>
                <p className="text-xs font-medium text-foreground">{d.name}</p>
                {d.mac && <p className="text-[10px] text-muted-foreground">{d.mac}</p>}
              </div>
              <button
                onClick={() => onConnect(d.deviceId)}
                className="text-xs font-medium text-primary px-3 py-1.5 rounded-lg bg-primary/10 active:scale-[0.97]"
              >
                Conectar
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Connected controls */}
      {connectedDevice && (
        <button
          onClick={onDisconnect}
          className="w-full rounded-xl border border-border py-2.5 text-xs text-destructive font-medium active:scale-[0.98]"
        >
          Desconectar
        </button>
      )}
    </div>
  );
}
