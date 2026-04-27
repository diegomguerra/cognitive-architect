/**
 * BLEDebugPanel — Live BLE diagnostic panel for QRing.
 *
 * Subscribes to the QRingPlugin's `debug` event and renders raw BLE
 * counters + last hex packets in real time. Useful for tester-side
 * diagnosis of why samples aren't arriving (write count, notify
 * count, last error, discovered services/characteristics).
 */

import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';

interface DebugState {
  writesSent: number;
  notifiesReceived: number;
  lastWriteHex: string;
  lastNotifyHex: string;
  lastError: string;
  discoveredServices: string[];
  discoveredCharacteristics: string[];
}

const initialDebug: DebugState = {
  writesSent: 0,
  notifiesReceived: 0,
  lastWriteHex: '',
  lastNotifyHex: '',
  lastError: '',
  discoveredServices: [],
  discoveredCharacteristics: [],
};

export default function BLEDebugPanel() {
  const [debug, setDebug] = useState<DebugState>(initialDebug);
  const [hasReceived, setHasReceived] = useState(false);

  useEffect(() => {
    const w = window as { Capacitor?: { Plugins?: Record<string, { addListener?: (event: string, cb: (ev: unknown) => void) => Promise<{ remove?: () => void }> }> } };
    const plugin = w.Capacitor?.Plugins?.QRingPlugin;
    if (!plugin?.addListener) return;
    let handle: { remove?: () => void } | null = null;
    plugin
      .addListener('debug', (ev: unknown) => {
        const e = ev as Partial<DebugState>;
        setHasReceived(true);
        setDebug({
          writesSent: e.writesSent ?? 0,
          notifiesReceived: e.notifiesReceived ?? 0,
          lastWriteHex: e.lastWriteHex ?? '',
          lastNotifyHex: e.lastNotifyHex ?? '',
          lastError: e.lastError ?? '',
          discoveredServices: e.discoveredServices ?? [],
          discoveredCharacteristics: e.discoveredCharacteristics ?? [],
        });
      })
      .then((h) => {
        handle = h;
      })
      .catch(() => { /* not native, ignore */ });
    return () => {
      try { handle?.remove?.(); } catch { /* noop */ }
    };
  }, []);

  return (
    <div className="rounded-2xl bg-card border border-border p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'hsl(var(--vyr-accent-action) / 0.15)' }}>
          <Activity size={20} style={{ color: 'hsl(var(--vyr-accent-action))' }} />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">Diagnóstico BLE</h3>
          <p className="text-[10px] text-muted-foreground">Bytes brutos do anel em tempo real</p>
        </div>
        {hasReceived && (
          <span
            className="text-[10px] font-medium px-2 py-0.5 rounded-full"
            style={{ background: 'hsl(var(--vyr-accent-action) / 0.15)', color: 'hsl(var(--vyr-accent-action))' }}
          >
            ao vivo
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Counter label="Escritas enviadas" value={debug.writesSent} />
        <Counter label="Notify recebidos" value={debug.notifiesReceived} />
      </div>

      <HexLine label="Última escrita" hex={debug.lastWriteHex} />
      <HexLine label="Último notify" hex={debug.lastNotifyHex} />

      {debug.lastError && (
        <div className="rounded-lg bg-destructive/10 p-2.5">
          <p className="text-[10px] font-medium text-destructive mb-0.5">Último erro</p>
          <p className="text-[10px] font-mono text-destructive break-all">{debug.lastError}</p>
        </div>
      )}

      {debug.discoveredServices.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Services BLE descobertos</p>
          <div className="space-y-1">
            {debug.discoveredServices.map((s, i) => (
              <p key={`${s}-${i}`} className="text-[10px] font-mono text-foreground break-all">{s}</p>
            ))}
          </div>
        </div>
      )}

      {debug.discoveredCharacteristics.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Characteristics ({debug.discoveredCharacteristics.length})</p>
          <div className="space-y-0.5 max-h-32 overflow-y-auto">
            {debug.discoveredCharacteristics.map((c, i) => (
              <p key={`${c}-${i}`} className="text-[9px] font-mono text-foreground break-all">{c}</p>
            ))}
          </div>
        </div>
      )}

      {!hasReceived && (
        <p className="text-[10px] text-muted-foreground italic">
          Aguardando primeiro evento BLE. Toque em "Conectar agora" ou "Sincronizar tudo" pra começar.
        </p>
      )}
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/30 p-2.5">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold text-foreground tabular-nums">{value}</p>
    </div>
  );
}

function HexLine({ label, hex }: { label: string; hex: string }) {
  if (!hex) return null;
  // truncate very long hex strings
  const display = hex.length > 200 ? hex.slice(0, 200) + '…' : hex;
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="text-[10px] font-mono text-foreground break-all bg-muted/30 rounded p-2">
        {display}
      </p>
    </div>
  );
}
