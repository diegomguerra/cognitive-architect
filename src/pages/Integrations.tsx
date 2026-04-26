import { useState } from 'react';
import { Heart, Info, Check, RefreshCw, Unplug, Wifi } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { useNavigate } from 'react-router-dom';
import BottomNav from '@/components/BottomNav';
import { useVYRStore } from '@/hooks/useVYRStore';
import { toast } from 'sonner';
import BiomarkerDataCard from '@/components/BiomarkerDataCard';
import DebugConsole from '@/components/DebugConsole';
import QRingModule from '@/wearables/qring/QRingModule';

const dataTypes = [
  { label: 'Frequência Cardíaca', key: 'heartRate' },
  { label: 'FC Repouso (RHR)', key: 'restingHeartRate' },
  { label: 'HRV (SDNN / RMSSD)', key: 'hrv' },
  { label: 'Sono (duração + estágios)', key: 'sleep' },
  { label: 'Passos', key: 'steps' },
  { label: 'SpO₂', key: 'oxygenSaturation' },
  { label: 'Frequência respiratória', key: 'respiratoryRate' },
  { label: 'Nível de estresse', key: 'stress' },
];

const IntegrationsPage = () => {
  const navigate = useNavigate();
  const { wearableConnection, connectWearable, disconnectWearable, syncWearable } = useVYRStore();
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const isConnected = wearableConnection?.status === 'active' || wearableConnection?.status === 'connected';

  const handleConnect = async () => {
    setConnecting(true);
    const ok = await connectWearable();
    setConnecting(false);
    if (!ok) toast.error('Apple Health não disponível. Disponível apenas no app iOS.');
  };

  const handleSync = async () => {
    setSyncing(true);
    const ok = await syncWearable();
    setSyncing(false);
    if (ok) toast.success('Dados sincronizados');
    else toast.error('Falha na sincronização');
  };

  const handleDisconnect = async () => {
    await disconnectWearable();
    toast.success('Desconectado');
  };

  const lastSync = wearableConnection?.lastSyncAt
    ? new Date(wearableConnection.lastSyncAt).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      })
    : null;

  return (
    <div className="min-h-dvh bg-background pb-24 safe-area-top">
      <header className="flex items-center gap-3 px-5 py-4">
        <BackButton />
        <div>
          <h1 className="text-lg font-semibold text-foreground">Integrações</h1>
          <p className="text-xs text-muted-foreground">Dados de saúde conectados ao motor cognitivo.</p>
        </div>
      </header>

      <div className="px-5 mt-2 space-y-4">

        {/* Apple Health card */}
        <div className="rounded-2xl bg-card border border-border p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'hsl(var(--vyr-accent-stable) / 0.15)' }}>
              <Heart size={20} style={{ color: 'hsl(var(--vyr-accent-stable))' }} />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-foreground">Apple Health</h3>
              <p className="text-xs text-muted-foreground">
                {isConnected ? 'Sincronizando dados de saúde' : 'Não conectado'}
              </p>
            </div>
            {isConnected && (
              <span
                className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                style={{ background: 'hsl(var(--vyr-accent-stable) / 0.15)', color: 'hsl(var(--vyr-accent-stable))' }}
              >
                Ativo
              </span>
            )}
          </div>

          {isConnected ? (
            <>
              {lastSync && (
                <p className="text-[10px] text-muted-foreground mb-3">
                  Última sincronização: {lastSync}
                </p>
              )}
              <div className="space-y-1.5 mb-4">
                {dataTypes.map((dt) => (
                  <div key={dt.key} className="flex items-center gap-2">
                    <Check size={14} style={{ color: 'hsl(var(--vyr-accent-stable))' }} />
                    <span className="text-xs text-foreground">{dt.label}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="flex-1 rounded-xl border border-border py-2.5 text-xs font-medium text-foreground flex items-center justify-center gap-1.5 active:scale-[0.98] disabled:opacity-50"
                >
                  <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
                  {syncing ? 'Sincronizando...' : 'Sincronizar agora'}
                </button>
                <button
                  onClick={handleDisconnect}
                  className="rounded-xl border border-border py-2.5 px-4 text-xs text-destructive flex items-center gap-1.5 active:scale-[0.98]"
                >
                  <Unplug size={14} />
                  Desconectar
                </button>
              </div>
            </>
          ) : (
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="w-full rounded-xl font-medium py-3 text-sm transition-all active:scale-[0.98] disabled:opacity-50 text-white"
              style={{ background: 'hsl(var(--vyr-accent-stable))' }}
            >
              {connecting ? 'Conectando...' : 'Conectar Apple Health'}
            </button>
          )}
        </div>

        {/* Biomarker data card */}
        {isConnected && <BiomarkerDataCard />}

        {/* QRing BLE direct connection */}
        <QRingModule />

        {/* Supported devices info */}
        <div className="rounded-2xl bg-card border border-border p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
              <Wifi size={18} className="text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs font-medium text-foreground mb-1">Dispositivos compatíveis</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Apple Watch, QRing, Garmin, Whoop, Oura, Withings e qualquer dispositivo que sincronize com o Apple Health são suportados automaticamente. O QRing também pode ser conectado diretamente via Bluetooth acima.
              </p>
            </div>
          </div>
        </div>

      </div>

      <DebugConsole />
      <BottomNav />
    </div>
  );
};

export default IntegrationsPage;
