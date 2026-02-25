

## Status das dependências

1. **Swift (`VYRHealthBridge.swift`)** — `@objc func requestAuthorization` já implementado (diff anterior).
2. **TypeScript bridge (`healthkit-bridge.ts`)** — `requestAuthorization` já declarado na linha 15. A assinatura atual retorna `Promise<{ granted: boolean }>` (não `Promise<void>`), o que é correto pois o Swift resolve com `["granted": true]`.
3. **`healthkit.ts`** — falta a chamada ao bridge após a linha 87.

## Plano

**Arquivo:** `src/lib/healthkit.ts`

Após a linha 87 (`await Health.requestAuthorization(...)`) inserir:

```ts
    // Request bridge-only types (resting HR, HRV, SpO2, respiratory rate)
    await VYRHealthBridge.requestAuthorization({
      readTypes: ['restingHeartRate', 'heartRateVariability', 'oxygenSaturation', 'respiratoryRate'],
      writeTypes: [],
    });
```

O import de `VYRHealthBridge` já existe na linha 4 do arquivo (`import { VYRHealthBridge } from './healthkit-bridge'`), então nenhuma alteração de imports é necessária.

**Nenhuma outra mudança é necessária** — tanto o Swift quanto o TypeScript bridge já estão prontos.

