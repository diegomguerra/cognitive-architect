

# Plano Completo: Reconstrucao VYR Labs

**Regra absoluta**: Este projeto usa exclusivamente Supabase externo (projeto `uirbicdwikvgnuounlia`). Nenhuma migracao para Lovable Cloud sera feita em momento algum.

---

## Fase 1: Tabelas Faltantes no Supabase

As seguintes tabelas existem: `participantes`, `referencias_populacionais`, `registros_dose`, `resumos_diarios`, `ring_daily_data`, `user_consents`, `user_integrations`, `webhook_logs`.

Tabelas a criar via migration SQL:

| Tabela | Descricao |
|--------|-----------|
| `computed_states` | Estado VYR calculado por dia (score, pillars, level, phase) |
| `action_logs` | Registro de acoes do protocolo (BOOT/HOLD/CLEAR) |
| `checkpoints` | Checkpoints do usuario durante o dia |
| `daily_reviews` | Revisoes diarias subjetivas (sliders 0-10) |
| `notifications` | Notificacoes enviadas ao usuario |
| `notification_preferences` | Preferencias de notificacao |
| `user_roles` | Roles do usuario (admin, participant) |
| `user_baselines` | Baselines z-score dos ultimos 14 dias |

Todas com `user_id UUID NOT NULL` (sem FK para `auth.users`), `created_at`, `updated_at`.

Constraint unico em `ring_daily_data`: `(user_id, day, source_provider)`.

## Fase 2: RLS Rigoroso

Corrigir politicas faltantes nas tabelas existentes:

- `ring_daily_data`: faltam INSERT, UPDATE, DELETE
- `user_integrations`: faltam INSERT, UPDATE, DELETE
- `user_consents`: falta UPDATE, DELETE
- `webhook_logs`: sem politica (service_role only -- bloquear tudo para anon)

Para todas as novas tabelas, criar 4 politicas cada (SELECT, INSERT, UPDATE, DELETE) com `user_id = auth.uid()`.

Excecoes:
- `referencias_populacionais`: SELECT publico (ja existe)
- `webhook_logs`: nenhuma politica para anon (apenas service_role acessa)

## Fase 3: Arquivos de Codigo a Criar

### Auth Hardening
- **`src/lib/auth-session.ts`**: `forceRefreshSession()`, `requireValidUserId()`, `retryOnAuthErrorLabeled(fn)` -- wrapper que detecta erro 42501, faz refresh e retenta uma vez

### HealthKit Integration
- **`src/lib/healthkit.ts`**: Modulo completo com `isHealthKitAvailable()`, `requestHealthKitPermissions()`, `syncHealthKitData()`, processamento de sono (excluir awake/inBed, qualidade = % deep + REM x 2.5), conversao HRV logaritmica

### Baseline
- **`src/lib/vyr-baseline.ts`**: Calculo de z-score com janela de 14 dias, fallback populacional se < 3 dias

### Paginas Faltantes
- **`src/pages/StateDetail.tsx`**: Detalhe expandido do estado cognitivo
- **`src/pages/MomentAction.tsx`**: Tela de acao do protocolo ativo
- **`src/pages/History.tsx`**: Grafico de evolucao (Recharts)
- **`src/pages/Perceptions.tsx`**: Sliders 0-10 de percepcao subjetiva
- **`src/pages/Reviews.tsx`**: Lista de revisoes diarias
- **`src/pages/Signals.tsx`**: Sinais biometricos detalhados
- **`src/pages/Integrations.tsx`**: Tela de conexao HealthKit/wearables
- **`src/pages/Profile.tsx`**: Perfil do usuario
- **`src/pages/Notifications.tsx`**: Central de notificacoes
- **`src/pages/ForgotPassword.tsx`**: Recuperacao de senha

### Edge Functions
- **`supabase/functions/generate-insights/index.ts`**: Gera insights via Gemini 2.5 Flash (usa service_role)
- **`supabase/functions/send-contact-email/index.ts`**: Envia email via Resend (secret ja existe)
- **`supabase/functions/ingest-wearable-data/index.ts`**: Recebe dados de wearables e faz upsert em `ring_daily_data`

### iOS Build Pipeline
- **`scripts/patch-ios.mjs`**: Script Node que modifica `Info.plist` (NSHealthShareUsageDescription, NSHealthUpdateUsageDescription), `App.entitlements` (com.apple.developer.healthkit), e `project.pbxproj` (SystemCapability HealthKit)

### Componentes Visuais
- **`src/components/EvolutionChart.tsx`**: Grafico Recharts de evolucao do score
- **`src/components/MiniScoreRing.tsx`**: Ring pequeno para listas
- **`src/components/CognitivePerformanceCard.tsx`**: Card de performance cognitiva
- **`src/components/ConnectionStatus.tsx`**: Pill de status do wearable (com vermelho pulsante para "Sem wearable")
- **`src/components/ScoreDelta.tsx`**: Componente de delta extraido da Home

### Configuracao Capacitor
- **`capacitor.config.ts`**: Configuracao Capacitor 8 com appId, appName, webDir

### Auth Context
- **`src/contexts/AuthContext.tsx`**: Provider React com sessao Supabase, login, logout, onAuthStateChange

## Fase 4: Rotas no App.tsx

Adicionar todas as rotas novas com protecao via AuthContext (redirect para `/login` se nao autenticado).

## Fase 5: Integracao Login Real

Atualizar `Login.tsx` para usar `supabase.auth.signInWithPassword()` e `supabase.auth.signInWithOAuth()` (Google, Apple). Atualizar `ForgotPassword.tsx` com `supabase.auth.resetPasswordForEmail()`.

---

## Detalhes Tecnicos

### Estrutura de Pastas Final

```text
src/
  components/
    ui/            (shadcn -- ja existe)
    BottomNav.tsx
    BrainLogo.tsx
    ContextCard.tsx
    InsightCard.tsx
    StateRing.tsx
    PillarRing.tsx
    EvolutionChart.tsx
    MiniScoreRing.tsx
    CognitivePerformanceCard.tsx
    ConnectionStatus.tsx
    ScoreDelta.tsx
    NavLink.tsx
  contexts/
    AuthContext.tsx
  hooks/
    use-mobile.tsx
    use-toast.ts
  integrations/
    supabase/
      client.ts
      types.ts
  lib/
    utils.ts
    auth-session.ts
    healthkit.ts
    vyr-engine.ts
    vyr-interpreter.ts
    vyr-baseline.ts
  pages/
    Home.tsx
    Login.tsx
    ForgotPassword.tsx
    Labs.tsx
    Settings.tsx
    StateDetail.tsx
    MomentAction.tsx
    History.tsx
    Perceptions.tsx
    Reviews.tsx
    Signals.tsx
    Integrations.tsx
    Profile.tsx
    Notifications.tsx
    NotFound.tsx
  test/
    example.test.ts
    setup.ts
supabase/
  config.toml
  functions/
    generate-insights/
      index.ts
    send-contact-email/
      index.ts
    ingest-wearable-data/
      index.ts
scripts/
  patch-ios.mjs
capacitor.config.ts
```

### Regras Criticas Mantidas
- Nunca usar `supabase.auth.getUser()` para validar writes -- sempre `requireValidUserId()`
- Nunca logar tokens
- Nunca depender de sessao via URL no iOS
- Sempre forcar refresh apos dialogo HealthKit
- 100% dos writes usam `retryOnAuthErrorLabeled()`
- Projeto permanece conectado ao Supabase externo -- NUNCA migrar para Lovable Cloud

### Secrets Necessarias
- `GEMINI_API_KEY`: necessaria para a edge function `generate-insights` (sera solicitada ao usuario)
- `RESEND_API_KEY`: ja configurada

### Ordem de Execucao
1. Migration SQL (tabelas + RLS + constraints)
2. Arquivos de lib (auth-session, healthkit, baseline)
3. Auth context
4. Paginas e componentes
5. Rotas no App.tsx
6. Edge functions
7. Scripts iOS
8. Capacitor config

