import type { DeviceDiagnostics } from '@/lib/wearable/types';

interface Props {
  diagnostics: DeviceDiagnostics | null;
}

const DEV_MODE = import.meta.env.VITE_DEV_MODE === 'true';

export default function DiagnosticsPanel({ diagnostics }: Props) {
  if (!DEV_MODE || !diagnostics) return null;

  const rows = [
    { label: 'Device ID', value: diagnostics.deviceId },
    { label: 'MAC', value: diagnostics.mac ?? '—' },
    { label: 'Firmware', value: diagnostics.fwVersion ?? '—' },
    { label: 'Bateria', value: diagnostics.battery != null ? `${diagnostics.battery}%` : '—' },
    { label: 'Último erro', value: diagnostics.lastError ?? 'Nenhum' },
    { label: 'Último sync', value: diagnostics.lastSync ?? '—' },
  ];

  return (
    <div className="rounded-2xl bg-card border border-border p-4 space-y-2">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Diagnósticos (DEV)</h3>
      {rows.map((r) => (
        <div key={r.label} className="flex justify-between text-xs">
          <span className="text-muted-foreground">{r.label}</span>
          <span className="text-foreground font-mono text-[11px]">{r.value}</span>
        </div>
      ))}
    </div>
  );
}
