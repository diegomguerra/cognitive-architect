/**
 * HealthKit — STUBBED 2026-05-16.
 *
 * Decisão Diego 2026-05-16: VYR passa a depender exclusivamente do raw data
 * dos anéis via parse-vendor-raw (Supabase Edge Function). Toda integração
 * com Apple Health / HealthKit foi descontinuada no client.
 *
 * - Dados históricos PERMANECEM no banco (biomarker_samples_archive,
 *   user_integrations rows com provider='apple_health') para análise.
 * - Este arquivo mantém os exports originais como no-ops pra não quebrar
 *   imports existentes. Pode ser deletado em release futura junto com
 *   src/lib/healthkit-bridge.ts e src/lib/health-lifecycle.ts.
 * - O Swift bridge `ios/App/App/VYRHealthBridge.swift` está intocado mas
 *   inerte (nada do JS chama ele).
 */

export const HEALTH_READ_TYPES: string[] = [];
export const HEALTH_WRITE_TYPES: string[] = [];
export const BRIDGE_READ_TYPES = [] as const;
export const BRIDGE_ONLY_WRITE_TYPES = [] as const;

export async function isHealthKitAvailable(): Promise<boolean> {
  return false;
}

export async function checkHealthKitPermissions(): Promise<boolean> {
  return false;
}

export async function requestHealthKitPermissions(): Promise<boolean> {
  return false;
}

export async function enableHealthKitBackgroundSync(): Promise<void> {
  // no-op
}

export async function runIncrementalHealthSync(_trigger: string): Promise<boolean> {
  return false;
}

export async function syncHealthKitData(): Promise<boolean> {
  return false;
}

export async function writeHealthSample(..._args: unknown[]): Promise<void> {
  // no-op
}

export async function writeBloodPressure(..._args: unknown[]): Promise<void> {
  // no-op
}

export async function loadAnchor(_type: string): Promise<string | undefined> {
  return undefined;
}

export async function saveAnchor(_type: string, _anchor: string): Promise<void> {
  // no-op
}

/**
 * convertHRVtoScale — mantido como alias de normalizeHRV (vyr-engine) só para
 * compat com src/test/vyr-engine-hrv-spo2.test.ts que ainda importa daqui.
 * Pode ser removido junto com o resto deste arquivo em release futura.
 */
export function convertHRVtoScale(ms: number): number {
  const clamped = Math.max(5, Math.min(200, ms));
  return ((Math.log(clamped) - Math.log(5)) / (Math.log(200) - Math.log(5))) * 100;
}
