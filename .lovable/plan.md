

# Plano de Implementacao Completa -- VYR App 4K

## Visao Geral

Este plano cobre TODAS as lacunas entre a implementacao atual e a documentacao funcional completa. A execucao sera feita em blocos logicos, sem pular nenhum detalhe.

---

## Bloco 1: Correcao de RLS (Database Migration)

Todas as policies estao marcadas como **RESTRICTIVE** no banco. Precisam ser recriadas como **PERMISSIVE**.

- Dropar todas as policies existentes de todas as tabelas
- Recriar todas com a clausula `PERMISSIVE` explicita
- Tabelas afetadas: `action_logs`, `checkpoints`, `computed_states`, `daily_reviews`, `notification_preferences`, `notifications`, `participantes`, `registros_dose`, `resumos_diarios`, `ring_daily_data`, `user_baselines`, `user_consents`, `user_integrations`, `user_roles`
- `referencias_populacionais` mantem SELECT publico, tambem PERMISSIVE
- `webhook_logs` permanece sem policies publicas

---

## Bloco 2: Hook Central `useVYRStore`

Criar `src/hooks/useVYRStore.ts` -- hook unico que centraliza TODOS os dados do banco:

**State:**
- `state: VYRState` (de `computed_states`, dia de hoje)
- `hasData: boolean`
- `checkpoints` (de hoje)
- `dailyReviews` (ultimas 7)
- `actionLogs` (de hoje)
- `historyByDay` (ultimos 30 dias de `computed_states`)
- `wearableConnection` (de `user_integrations`, provider=apple_health)
- `sachetConfirmation: { show: boolean; phase: string }`

**Actions:**
- `addCheckpoint(note: string)`
- `logAction(phase: string, payload?: object)`
- `dismissConfirmation()`
- `activateTransition(targetPhase: string)`
- `connectWearable()`, `disconnectWearable()`, `syncWearable()`
- `refresh()` para recarregar dados

**Queries paralelas ao montar:**
1. `computed_states` -- ultimos 30 dias, order by day desc
2. `action_logs` -- filtro day = hoje
3. `checkpoints` -- filtro day = hoje
4. `daily_reviews` -- ultimas 7, order by day desc
5. `user_integrations` -- provider = "apple_health"

---

## Bloco 3: Correcao do Interpreter

Arquivo `src/lib/vyr-interpreter.ts`:

- Corrigir bug na linha 128: `import('./vyr-engine').then` e um dynamic import que nunca resolve. Substituir por chamada sincrona a `getRichLabelSync(score, pillars)`
- Adicionar campos separados ao `Interpretation`:
  - `whyScore: string`
  - `dayRisk: string`  
  - `limitingFactorText: string`
  - `systemReadingType: 'insight' | 'warning' | 'positive'` (baseado no score)

---

## Bloco 4: Componentes Visuais Corrigidos

### 4.1 EvolutionChart → AreaChart

- Trocar `LineChart`/`Line` por `AreaChart`/`Area` do Recharts
- Area com gradient fill: Slate Blue/40% → Slate Blue/5%
- Dots: r=3, activeDot r=5
- Eixo X: dias da semana abreviados
- Eixo Y: range dinamico (min-10 a max+10)
- Tooltip formatado como "DD de MMMM"
- Header: "ULTIMOS {N} DIAS" + legenda com dot

### 4.2 MiniScoreRing -- cor por score

- score >= 70: Slate Blue (`--vyr-accent-action`)
- score >= 40: Amber Clay (`--vyr-accent-transition`)
- score < 40: vermelho (`#EF4444`)
- Numero central: text-sm font-medium

### 4.3 PatternCard (novo componente)

- Localizado em `src/components/PatternCard.tsx`
- Card bg-card rounded-2xl p-4
- Header: icone TrendingUp + "PADROES DETECTADOS" + periodo
- Lista de padroes detectados (bullets com dot accent-action)
- Logica de deteccao (simplificada): analisa `historyByDay` para encontrar correlacoes basicas
- Requer minimo 7 dias

---

## Bloco 5: Home Completa (reescrita)

Reescrever `src/pages/Home.tsx` usando `useVYRStore` e seguindo a ordem exata do doc:

1. **Header**: saudacao + NotificationBell + ConnectionStatusPill
2. **StateRing** (220x220, clicavel → /state)
3. **ScoreDelta** (condicional, so com dados)
4. **PillarRings** (3 mini rings em row, so com dados)
5. **ContextCard** com subtitulo explicativo
6. **CognitiveWindowCard** (condicional)
7. **InsightCard** "Leitura do sistema" com whyScore + dayRisk + limitingFactor
8. **Card "Hoje isso significa"** (clicavel → /state)
9. **TransitionCard** (condicional)
10. **Secao de Acao Principal**:
    - Card explicativo do sachet/fase atual
    - ActionButton com cores por fase (BOOT=#556B8A, HOLD=#8F7A4A, CLEAR=#4F6F64)
    - Nota "Registre aqui quando tomar o sachet..."
11. **SachetConfirmation** modal

---

## Bloco 6: StateDetail Completo

- Header com nivel
- StateRing (animate=false)
- Card de pilares detalhados com PillarRing 56px + valor/5 + descricao interpretativa
- Separadores h-px entre pilares
- InsightCard "Diagnostico do sistema"
- Texto contextual muted centralizado

(Ja esta implementado mas precisa usar `useVYRStore`)

---

## Bloco 7: MomentAction Completo

- Header com gradiente por fase
- Icone Play grande (48px, circulo bg-card)
- Titulo + system text
- Card "O QUE VAI ACONTECER" + divider + "O QUE ESPERAR"
- ActionButton fixo no bottom com gradiente
- Ao confirmar: `logAction()` → `SachetConfirmation` → volta pra Home

(Ja implementado mas precisa do SachetConfirmation inline e usar `useVYRStore`)

---

## Bloco 8: Checkpoint Modal

Criar `src/components/CheckpointModal.tsx`:

- Overlay: bg-black/60 backdrop-blur-sm, fixed inset-0
- Card: rounded-t-3xl, bg-card, animate-slide-up, posicionado no bottom
- "CHECKPOINT DO SISTEMA" (uppercase)
- Pergunta: "Como voce percebe este momento agora?"
- Textarea com estilos VYR
- 2 botoes: "Agora nao" (outline) + "Registrar" (accent-action)
- Salva via `useVYRStore.addCheckpoint(note)`

---

## Bloco 9: DayReview Page

Criar `src/pages/DayReview.tsx`:

- Header: voltar + "Encerramento do dia"
- Estrutura narrativa:
  - "INICIO DO DIA" + narrativa gerada
  - "AO LONGO DO DIA" + narrativa
  - "ENCERRAMENTO" + narrativa
  - Divider
  - Valor gerado pelo sistema
  - Linha final (italic, muted)
- Narrativas geradas automaticamente a partir dos dados do dia (score, pilares, acoes tomadas)
- Rota: `/day-review/:day`

---

## Bloco 10: Labs Completo

### 10.1 HistoryTab

- EvolutionChart (AreaChart corrigido)
- PatternCard (novo)
- Lista de dias com MiniScoreRing colorido + delta + notas

### 10.2 PerceptionsTab

- Tutorial dismissivel (ja implementado)
- CognitivePerformanceCard com toggle geral/fase (ja implementado)
- **Adicionar PhaseHistoryCard**: historico de percepcoes agrupado por data, mostrando F/C/E/Es + media
- **Adicionar Observacoes Livres**: lista de checkpoints do usuario com icone Clock + data/hora + nota

### 10.3 ReviewsTab

- Lista de daily_reviews com botao → navegar para DayReview
- (Ja implementado, precisa do link para DayReview)

### 10.4 SignalsTab

- (Ja implementado, correto)

---

## Bloco 11: Settings Completo

Reescrever `src/pages/Settings.tsx`:

1. **Card usuario** (avatar + nome + email)
2. **Perfil**: link → /profile
3. **Notificacoes**: 3 switches (push, insights, lembretes de sachets) + link "Ver todas" → /notifications
4. **Integracoes**: link → /integrations
5. **Wearable**: status de conexao, provider, ultima sincronizacao, botoes Reconectar/Desconectar
6. **Dados**: baseline progress bar (0-7 dias)
7. **Privacidade**: texto sobre processamento
8. **Conta**: botao Sair (vermelho)
9. **Build info**: versao + SHA + data (font-mono, opacity 40%)

---

## Bloco 12: Profile com Avatar Upload

- Criar componente `AvatarUpload` que usa Supabase Storage
- Criar bucket `avatars` no Supabase Storage
- Upload de imagem com preview
- Salvar URL no campo de participantes (ou usar path convencional `avatars/{user_id}`)
- Demais campos ja implementados

---

## Bloco 13: Integrations com Estado Conectado

Reescrever `src/pages/Integrations.tsx`:

- Apple Health Card:
  - **Conectado**: badge "Conectado", ultima sincronizacao, lista de dados autorizados (FC, HRV, Sono, Passos, Treinos com checks verdes), botoes "Sincronizar agora" + "Desconectar"
  - **Desconectado**: botao gradient pink/red "Conectar Apple Health"
  - Logica: verifica `isNativePlatform()`, se web mostra toast
- J-Style Ring Card (mesma estrutura)
- Nota "Outros wearables"
- Usa `useVYRStore` para wearableConnection

---

## Bloco 14: Limpeza de Rotas

- Remover rotas standalone (`/history`, `/perceptions`, `/reviews`, `/signals`) do App.tsx
- Remover arquivos: `src/pages/History.tsx`, `src/pages/Perceptions.tsx`, `src/pages/Reviews.tsx`, `src/pages/Signals.tsx`
- Adicionar rota `/day-review/:day` para DayReview
- Adicionar rota `/checkpoint` ou usar modal overlay (sem rota)

---

## Bloco 15: Animacoes e CSS

Adicionar ao `index.css`:
- `.animate-delta-pulse` (ja existe como keyframe, falta a class utility)
- Garantir que todas as CSS vars mencionadas no doc existam
- Adicionar `.no-scrollbar` utility para tabs horizontais

---

## Secao Tecnica: Detalhes de Implementacao

### Ordem de Execucao

1. Migration SQL (RLS PERMISSIVE) + Storage bucket
2. `useVYRStore` hook
3. Correcao do Interpreter
4. Componentes visuais (EvolutionChart, MiniScoreRing, PatternCard, CheckpointModal)
5. DayReview page
6. Home reescrita
7. StateDetail, MomentAction (refatorar para useVYRStore)
8. Labs tabs (HistoryTab, PerceptionsTab com historico)
9. Settings, Profile, Integrations, Notifications
10. Limpeza de rotas e arquivos legados
11. CSS e animacoes finais

### Dependencias

- `useVYRStore` depende das tabelas existentes (sem mudanca de schema necessaria alem do RLS)
- DayReview depende de narrativa gerada (sera client-side baseada nos dados)
- AvatarUpload depende do storage bucket `avatars`
- Todas as escritas usam `retryOnAuthErrorLabeled()`

