

# Plano: Corrigir sincronização do Apple Health e adicionar visibilidade dos biomarcadores

## Problema atual

1. **Sync nunca dispara automaticamente** -- `connectWearable()` conecta e pede permissoes, mas nao chama `syncWearable()` apos sucesso
2. **Bug de double-lock** -- `runIncrementalHealthSync` ativa `syncLock = true`, depois chama `syncHealthKitData()` que tambem verifica `syncLock` e retorna `false` imediatamente, impedindo qualquer sync via observer/manual incremental
3. **Sem visibilidade no app** -- nao existe nenhuma tela ou secao que mostre os biomarcadores brutos recebidos do Apple Health

## Correcoes

### 1. Auto-sync apos conectar (src/hooks/useVYRStore.ts)

Na funcao `connectWearable`, apos o `enableHealthKitBackgroundSync()`, adicionar chamada a `runIncrementalHealthSync('manual')` para disparar a primeira sincronizacao imediatamente.

### 2. Corrigir double-lock (src/lib/healthkit.ts)

Na funcao `runIncrementalHealthSync`, em vez de chamar `syncHealthKitData()` (que tem seu proprio lock), chamar a logica de sync diretamente ou passar um parametro interno que pule o check de lock. Solucao: extrair a logica interna de `syncHealthKitData` para uma funcao privada `_syncHealthKitDataInternal()` sem lock, e ambas `syncHealthKitData` e `runIncrementalHealthSync` usam ela dentro de seus proprios locks.

### 3. Adicionar secao de biomarcadores na pagina de Integracoes (src/pages/Integrations.tsx)

Quando conectado, mostrar um card abaixo do Apple Health com os ultimos dados sincronizados, lidos da tabela `ring_daily_data`:

- FC em repouso (rhr)
- HRV (hrv_sdnn)
- Sono (duracao + qualidade)
- Passos
- SpO2
- Freq. Respiratoria

Cada metrica exibida com icone, valor e unidade. Se nao houver dados, mostrar mensagem "Nenhum dado sincronizado ainda -- clique em Sincronizar".

## Detalhes tecnicos

### Arquivo: src/lib/healthkit.ts

```text
syncHealthKitData()          <-- lock publico, chama _internal()
runIncrementalHealthSync()   <-- lock proprio, chama _internal()
_syncHealthKitDataInternal() <-- sem lock, logica real
```

Mudancas:
- Extrair linhas 236-298 para `_syncHealthKitDataInternal()`
- `syncHealthKitData` mantem lock e chama `_syncHealthKitDataInternal()`
- `runIncrementalHealthSync` ja tem lock, chama `_syncHealthKitDataInternal()` em vez de `syncHealthKitData()`

### Arquivo: src/hooks/useVYRStore.ts

Na funcao `connectWearable`, apos a linha `await enableHealthKitBackgroundSync()`, adicionar:

```typescript
// Trigger first sync immediately after connecting
await runIncrementalHealthSync('manual');
setWearableConnection(prev => prev ? { ...prev, lastSyncAt: new Date().toISOString() } : prev);
```

### Arquivo: src/pages/Integrations.tsx

Adicionar um novo card "Dados Recebidos" que consulta `ring_daily_data` para o dia atual e exibe as metricas. Usa o hook `useVYRStore` existente ou uma query direta ao Supabase para buscar os dados.

