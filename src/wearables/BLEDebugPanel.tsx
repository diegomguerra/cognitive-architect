/**
 * BLEDebugPanel — Live BLE diagnostic panel for QRing.
 *
 * Subscribes to the QRingPlugin's `debug` event and renders raw BLE
 * counters + last hex packets in real time. Safe-guarded against
 * runtime errors (Capacitor not loaded, plugin missing, listener
 * registration failures) — never crashes the page.
 */

import { useEffect, useRef, useState } from 'react';
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
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let removeFn: (() => void) | null = null;

    try {
      const w = window as unknown as {
        Capacitor?: {
          Plugins?: Record<string, unknown>;
        };
      };
      const plugin = w.Capacitor?.Plugins?.QRingPlugin as
        | { addListener?: (event: string, cb: (ev: unknown) => void) => Promise<{ remove?: () => void } | undefined> }
        | undefined;

      if (!plugin || typeof plugin.addListener !== 'function') {
        return;
      }

      const handler = (ev: unknown) => {
        if (!mountedRef.current) return;
        try {
          const e = (ev ?? {}) as Partial<DebugState>;
          setHasReceived(true);
          setDebug({
            writesSent: typeof e.writesSent === 'number' ? e.writesSent : 0,
            notifiesReceived: typeof e.notifiesReceived === 'number' ? e.notifiesReceived : 0,
            lastWriteHex: typeof e.lastWriteHex === 'string' ? e.lastWriteHex : '',
            lastNotifyHex: typeof e.lastNotifyHex === 'string' ? e.lastNotifyHex : '',
            lastError: typeof e.lastError === 'string' ? e.lastError : '',
            discoveredServices: Array.isArray(e.discoveredServices) ? e.discoveredServices.map(String) : [],
            discoveredCharacteristics: Array.isArray(e.discoveredCharacteristics) ? e.discoveredCharacteristics.map(String) : [],
          });
        } catch {
          /* swallow */
        }
      };

      const result = plugin.addListener('debug', handler);
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<{ remove?: () => void } | undefined>)
          .then((handle) => {
            if (handle && typeof handle.remove === 'function') {
              removeFn = () => {
                try { handle.remove?.(); } catch { /* swallow */ }
              };
            }
          })
          .catch(() => { /* listener registration failed, ignore */ });
      }
    } catch {
      /* Capacitor not loaded or other error — render stays in idle state */
    }

    return () => {
      mountedRef.current = false;
      if (removeFn) removeFn();
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

      {debug.lastError ? (
        <div className="rounded-lg bg-destructive/10 p-2.5">
          <p className="text-[10px] font-medium text-destructive mb-0.5">Último erro</p>
          <p className="text-[10px] font-mono text-destructive break-all">{debug.lastError}</p>
        </div>
      ) : null}

      {debug.discoveredServices.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Services BLE descobertos</p>
          <div className="space-y-1">
            {debug.discoveredServices.map((s, i) => (
              <p key={`svc-${i}`} className="text-[10px] font-mono text-foreground break-all">{s}</p>
            ))}
          </div>
        </div>
      ) : null}

      {debug.discoveredCharacteristics.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Characteristics ({debug.discoveredCharacteristics.length})
          </p>
          <div className="space-y-0.5 max-h-32 overflow-y-auto">
            {debug.discoveredCharacteristics.map((c, i) => (
              <p key={`char-${i}`} className="text-[9px] font-mono text-foreground break-all">{c}</p>
            ))}
          </div>
        </div>
      ) : null}

      {!hasReceived ? (
        <p className="text-[10px] text-muted-foreground italic">
          Aguardando primeiro evento BLE. Toque em "Conectar agora" ou "Sincronizar agora" pra começar.
        </p>
      ) : null}
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
