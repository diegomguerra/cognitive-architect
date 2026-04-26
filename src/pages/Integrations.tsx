import { Wifi } from 'lucide-react';
import BackButton from '@/components/BackButton';
import BottomNav from '@/components/BottomNav';
import { useVYRStore } from '@/hooks/useVYRStore';
import BiomarkerDataCard from '@/components/BiomarkerDataCard';
import DebugConsole from '@/components/DebugConsole';
import RingPairingFlow from '@/wearables/RingPairingFlow';

const IntegrationsPage = () => {
  const { wearableConnection } = useVYRStore();
  const isConnected = wearableConnection?.status === 'active' || wearableConnection?.status === 'connected';

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

        {/* Unified ring + Apple Health pairing */}
        <RingPairingFlow />

        {/* Biomarker breakdown — visible after Apple Health is active */}
        {isConnected && <BiomarkerDataCard />}

        {/* Supported devices info */}
        <div className="rounded-2xl bg-card border border-border p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
              <Wifi size={18} className="text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs font-medium text-foreground mb-1">Dispositivos compatíveis</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                QRing, Apple Watch, Garmin, Whoop, Oura, Withings — tudo que aparece no Apple Health entra automaticamente no VYR. O QRing tem uma via direta extra via Bluetooth para coleta bruta de alta frequência.
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
