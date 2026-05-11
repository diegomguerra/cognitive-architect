import { useEffect, useState } from 'react';
import { Heart, Droplets, Thermometer, Activity, Play } from 'lucide-react';
import { QRingPlugin } from '@/wearables/qring/qring-bridge';
import { wearableStore } from '@/wearables/wearable.store';

type SensorType = 'hr' | 'spo2' | 'temp' | 'hrv';

type SensorConfig = {
  type: SensorType;
  label: string;
  Icon: typeof Heart;
  ledColor: string;
  defaultInterval: number;
  manualSupported: boolean;
};

const SENSORS: SensorConfig[] = [
  { type: 'hr',   label: 'Frequência cardíaca', Icon: Heart,       ledColor: '#7CC4FF', defaultInterval: 5,  manualSupported: true  },
  { type: 'spo2', label: 'SpO₂ (oxigênio)',     Icon: Droplets,    ledColor: '#D27474', defaultInterval: 30, manualSupported: true  },
  { type: 'temp', label: 'Temperatura',         Icon: Thermometer, ledColor: '#E8C77A', defaultInterval: 30, manualSupported: false },
  { type: 'hrv',  label: 'HRV (variabilidade)', Icon: Activity,    ledColor: '#9DD49D', defaultInterval: 30, manualSupported: false },
];

const INTERVAL_OPTIONS = [5, 15, 30, 60];

type SensorState = { enabled: boolean; intervalMin: number; lastAction?: string; busy?: boolean };

const STORAGE_KEY = 'vyr_sensor_toggles_v1';

function loadState(): Record<SensorType, SensorState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {
    hr:   { enabled: true, intervalMin: 5  },
    spo2: { enabled: true, intervalMin: 30 },
    temp: { enabled: true, intervalMin: 30 },
    hrv:  { enabled: true, intervalMin: 30 },
  };
}

function saveState(state: Record<SensorType, SensorState>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

export function SensorTogglesSection() {
  const [state, setState] = useState<Record<SensorType, SensorState>>(loadState);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const unsub = wearableStore.subscribe((s) => setConnected(!!s.connectedDevice));
    setConnected(!!wearableStore.getState().connectedDevice);
    return unsub;
  }, []);

  const update = async (type: SensorType, patch: Partial<SensorState>) => {
    const next = { ...state, [type]: { ...state[type], ...patch } };
    setState(next);
    saveState(next);

    if (!connected) return;
    try {
      next[type].busy = true;
      await QRingPlugin.setSensorAuto({
        type,
        intervalMin: next[type].intervalMin,
        enable: next[type].enabled,
      });
      next[type].lastAction = `Atualizado ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    } catch (e) {
      next[type].lastAction = `Erro: ${(e as Error).message}`;
    } finally {
      next[type].busy = false;
      setState({ ...next });
    }
  };

  const measureNow = async (type: SensorType) => {
    if (!connected) return;
    const next = { ...state };
    try {
      next[type].busy = true;
      setState({ ...next });
      await QRingPlugin.measureNow({ type: type as 'hr' | 'spo2', durationSec: 60 });
      next[type].lastAction = `Medindo (60s)…`;
    } catch (e) {
      next[type].lastAction = `Erro: ${(e as Error).message}`;
    } finally {
      next[type].busy = false;
      setState({ ...next });
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h3
          className="text-[18px] font-light tracking-[-0.01em] text-foreground"
          style={{ fontFamily: '"Inter Tight", Inter, sans-serif' }}
        >
          Sensores do anel
        </h3>
        <span className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground">
          {connected ? 'Conectado' : 'Desconectado'}
        </span>
      </div>

      {SENSORS.map((s) => {
        const cur = state[s.type];
        return (
          <div key={s.type} className="rounded-2xl border border-white/[0.08] bg-card p-4">
            <div className="flex items-center gap-3 mb-3">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: cur.enabled ? s.ledColor : '#444', boxShadow: cur.enabled ? `0 0 6px ${s.ledColor}` : 'none' }}
              />
              <s.Icon size={16} strokeWidth={1.5} className="text-foreground" />
              <span className="text-sm text-foreground flex-1" style={{ fontWeight: 500 }}>{s.label}</span>
              <button
                onClick={() => update(s.type, { enabled: !cur.enabled })}
                disabled={!connected || cur.busy}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${cur.enabled ? 'bg-primary' : 'bg-muted'}`}
                aria-label={`${cur.enabled ? 'Desativar' : 'Ativar'} ${s.label}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${cur.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            <div className="flex items-center gap-2 ml-7">
              <span className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground">A cada</span>
              <select
                value={cur.intervalMin}
                onChange={(e) => update(s.type, { intervalMin: Number(e.target.value) })}
                disabled={!connected || !cur.enabled || cur.busy}
                className="bg-transparent border border-white/[0.1] rounded px-2 py-1 text-xs text-foreground disabled:opacity-40 focus:outline-none focus:border-white/[0.3]"
              >
                {INTERVAL_OPTIONS.map((v) => (
                  <option key={v} value={v}>{v} min</option>
                ))}
              </select>
              {s.manualSupported && (
                <button
                  onClick={() => measureNow(s.type)}
                  disabled={!connected || cur.busy}
                  className="ml-auto flex items-center gap-1 text-[10px] uppercase tracking-wider px-2.5 py-1.5 rounded border border-white/[0.15] text-foreground hover:border-white/[0.3] disabled:opacity-40"
                >
                  <Play size={10} strokeWidth={2} />
                  Medir agora
                </button>
              )}
            </div>

            {cur.lastAction && (
              <div className="font-mono text-[9px] tracking-wider text-muted-foreground mt-2 ml-7 italic">
                {cur.lastAction}
              </div>
            )}
          </div>
        );
      })}

      {!connected && (
        <p className="text-xs text-muted-foreground italic">
          Conecte o anel para ativar/desativar os sensores.
        </p>
      )}
    </section>
  );
}
