import BackButton from '@/components/BackButton';
import BottomNav from '@/components/BottomNav';
import DebugConsole from '@/components/DebugConsole';
import RingPairingFlow from '@/wearables/RingPairingFlow';
import BLEDebugPanel from '@/wearables/BLEDebugPanel';

const IntegrationsPage = () => {

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

        {/* Pareamento BLE do anel */}
        <RingPairingFlow />

        {/* Painel de diagnóstico BLE — bytes brutos em tempo real */}
        <BLEDebugPanel />

      </div>

      <DebugConsole />
      <BottomNav />
    </div>
  );
};

export default IntegrationsPage;
