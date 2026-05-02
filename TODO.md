# VYR Labs — TODO consolidado

> Última atualização: 2026-05-02 (Mac mini sessão final antes de migrar para Windows laptop)

## Estado atual em produção (build TestFlight 8.1(341))

### 3 testers ativos
| Tester | Anel | Onboarding | Score 02/05 | Diagnóstico |
|---|---|---|---|---|
| Lídia (lilidoces@icloud.com) | JStyle X3 | ✗ | 58 Moderado | ✅ Honesto. RHR 54, HRV 45ms, 248 ring samples |
| Diego | JStyle X3 | ✓ | 49 Baixo | ⚠ Honesto mas limitado. Anel só envia stress (78 amostras), sem realtime HR |
| Daniele Faconi | Colmi R09 (fw 3.10.21) | ✗ | 6 Crítico | ❌ **Falso-positivo**. RHR=96 do fallback `min(hr_samples)` quando <20 amostras |

### Pipeline E2E (commits dessa sessão)
- `9c0e74c` JStyle parser hardening + RingParsers SPM package + 13 testes verdes
- `fd9540b` migration guide
- `68c5f37` release(ios): 8.1(340) — fastlane altool bypass
- `82a757e` chore: link RingParsers SPM package to App target
- `8aec3e6` refactor(qring): route JStyle paths through RingParsers package
- `e033d7e` release(ios): 8.1(341)
- `6b41f7d` chore: gitignore vendor-sdks/

### Infra de pé (não precisa mexer)
- `vendors_raw.{colmi,jstyle}_packets` schemas em ambos Supabase projects (Apple + Android) — **vazias, plugin ainda não dual-write**
- `vyr-compute-state` v8 (Apple) / v6 (Android) com `mergeQringBleIntoDaily` + `mergeProviderRows` (apple > garmin > oura > qring_ble)
- SwiftPM `ios/Packages/RingParsers/` com 13 testes verdes (`swift test` em <10s)
- Plugin `QRingPlugin.swift` migrado para JStyle paths via pacote
- Fastlane com altool bypass funcionando

---

## TODO em ordem de prioridade

### 🔥 EM EXECUÇÃO AGORA (sessão atual)

#### A — Fix `rhr` fallback threshold (15 min)
**Onde:** `vyr-compute-state` edge function, função `mergeQringBleIntoDaily` (em ambos Supabase projects)
**O quê:** mudar a regra de emissão de `rhr`:
- Atual: `>=20` → P10, `>=5` → min (PROBLEMA: `min` em sessão curta dá rhr falso alto)
- Novo: `>=50` → P10 (sleep window típico tem centenas), senão NÃO emite rhr (engine cai em baseline em vez de punir)

**Impacto direto:** Daniele sai de "Crítico 6" para algo realista após recompute.
**Status:** in_progress

#### B — Capturar 4-5 fixtures Colmi reais (40 min)
**Onde:** `ios/Packages/RingParsers/Tests/RingParsersTests/Fixtures/Colmi/`
**Source:** `biomarker_samples` da Daniele em 27/04 (229 packets) + 02/05 (62 packets) + Diego/Lídia se relevantes
**Padrão:** copiar shape dos fixtures JStyle existentes — JSON com `expected` constraints + `packets` array com `ts_offset_ms` + `channel` + `raw_hex`
**Fixtures a criar:**
1. `daniele_realtime_2026-04-27.json` — CMD 0x69 com RR LE16 funcional
2. `daniele_steps_history_2026-04-27.json` — CMD 0x43 multi-packet (vimos `43 00 03 31 ...`)
3. `daniele_handshake_2026-05-02.json` — connect + battery + setTime + history requests retornando FF sentinels
4. `daniele_temp_v2_2026-04-26.json` — CMD 0xBC big-data temperature (5 amostras 26/04)

#### C — Implementar `ColmiParser` no pacote SwiftPM (90 min)
**Onde:** `ios/Packages/RingParsers/Sources/RingParsers/Colmi/ColmiParser.swift`
**Hoje:** stub que retorna `unrecognized: ["colmi-parser-stub"]`
**Próximo:** implementar mirror do `JStyleParser` cobrindo:
- CMD 0x03 Battery
- CMD 0x15 HR History (Colmi multi-packet, 5-min interval, 288 slots/day)
- CMD 0x2C SpO2 History
- CMD 0x37 Stress History (Colmi b[2] mode)
- CMD 0x39 HRV History (firmware ≥ 3.00.10)
- CMD 0x43 Steps History (cumulative LE16 layout, 96 slots/day)
- CMD 0x44 Sleep History (4-byte windows: start_min_lo/start_min_hi/duration_min/stage)
- CMD 0x69 Realtime (HR/RR — same layout as JStyle for R09 variant)
- CMD 0xBC V2 Big Data (temperature, half-hour slots, formula `(byte/10)+20`)

**Source de verdade:** `project_qring_protocol.md` na memória (Puxtril + Gadgetbridge + tahnok + RingCLI). NÃO adivinhação — literatura pública.
**Validação:** rodar fixtures do passo B contra o ColmiParser, todas verdes em `swift test`.

#### E — Ring-only honest score (60 min)
**Onde:** `vyr-compute-state` edge function — adicionar lógica de confidence
**O quê:**
- Quando `merged_providers === ["qring_ble"]` (provider único) E ring_metrics tem < N amostras críticas (HR < 20, HRV < 5):
  - Score continua sendo computado MAS retorna `confidence: "low"` + `confidence_reason: "ring_only_short_window"`
  - UI lê isso e mostra "Calibrando — coletando mais dados" em vez de "Crítico"
- Frontend (`useVYRStore.ts` ou Home component) usa `confidence_level` para decidir como apresentar

**Impacto estrutural:** Daniele NUNCA mais aparece como "Crítico 6" mesmo se rhr fallback voltar — UI assume incerteza ao invés de confiança falsa.

---

### 📋 PRÓXIMAS SESSÕES (independentes, pode pegar em qualquer ordem)

#### D — Salvar `firmwareRev` por device em coluna dedicada
**Onde:** schema `public.devices` (Supabase) + plugin já lê em `firmwareRev` mas não envia
**Esforço:** 1h
**Por quê:** começa device profile catalog. Em 2 semanas a gente sabe o universo de firmwares ativos e correlaciona bugs com versão.

#### F — Plugin dual-write para `vendors_raw.{vendor}_packets`
**Onde:** `QRingPlugin.swift` no `emitDebugRaw` (já existe), adicionar segundo destino
**Esforço:** 2-3h
**Por quê:** schemas `vendors_raw` já existem (criados nessa sessão). Falta o gancho. Sem isso `debug_raw` rola em 7d e perdemos auditoria forense. Com isso "por que esse HR=X?" tem resposta deterministica para sempre.

#### G — Migrar caminho Colmi do `QRingPlugin.swift` para o pacote
**Esforço:** 2-3h
**Pré-requisito:** C completo (ColmiParser implementado)
**Por quê:** mirror do que fizemos com JStyle no commit `8aec3e6`. Plugin in-file Colmi tem ~500 linhas — vão para o pacote. QRingPlugin fica ~300 linhas (só BLE I/O + bridge JS). **Não urgente porque código in-file Colmi funciona em produção.**

#### H — Cohort monitoring
**Esforço:** 4h
**Por quê:** cron diário que verifica distribuição de scores por user. Detecta problema antes do tester reclamar. "80% dos novos users têm Crítico" → engine errado. "1 user sustained Crítico" → caso real.

#### I — Telemetria de sessão BLE estruturada
**Esforço:** 4h
**Por quê:** plugin emite `session_start`/`cmd_sent`/`notify_received`/`session_end` para tabela `ble_sessions`. Em 1 semana sabemos: "60% das sessões do Diego nunca recebem 0x69" → dado, não suspeita.

#### J — 1-tap mood diário (UX)
**Esforço:** 1 dia (UX + engine integration)
**Por quê:** `daily_reviews` é opcional → preenchido inconsistentemente → score sem ground truth para validar. 1-tap "como você se sentiu hoje?" 😣😕😐🙂😊 → 30 dias depois temos sinal para CALIBRAR engine pra ring-only.

---

### 🔒 BLOQUEADO POR DECISÃO/CONTATO EXTERNO

#### Email para `info@jointcorp.com` solicitando lib fat
**O quê:** pedir versão `libBleSDK.a` X3 com slice de simulador (atual é arm64-only, quebraria CI iphonesimulator se linkado)
**Template:**
> Hi — we're integrating JCRing Med X3 in our iOS health app via the BleSDK. The current `libBleSDK.a` (X3 SDK, file size 169KB) is arm64 only. Could you provide a universal/fat build with x86_64 simulator slice? Bundle ID: com.vyrlabs.app. Thanks.

#### Diego ring stuck in stress-stream-only
**Hipótese confirmada via SDK:** chamar `[BleSDK_X3 sharedManager] SetAutomaticHRMonitoring:mon]` com `mon.dataType=1, mon.mode=1, mon.intervalTime=5, mon.weeks=todos` no `connect()` força HR auto-mode.
**Caminho A:** linkar a lib (precisa fat) e chamar direto
**Caminho B:** capturar bytes que o demo Xcode envia rodando-o num iPhone real → hardcoded em `QRingPlugin.swift:doConnect()` → ship build 342

#### Lídia + Daniele completarem onboarding
**Por quê:** `useVYRStore.ts:217-323` gateia `bootstrapHealthSync` em `onboardingDone===true`. Sem isso Apple Health não auto-sync. Lídia tem Apple Watch — perde sleep + RHR sleep-window real.
**Ação:** mensagem para elas abrirem o app e completarem o questionário (~3 min).

---

## Arquitetura — referências rápidas

### Estrutura de pastas
```
~/cognitive-architect/
├── ios/
│   ├── App/                          # Xcode project (vai pra TestFlight)
│   │   ├── App.xcworkspace           # Abrir SEMPRE este, não o .xcodeproj
│   │   └── App/QRingPlugin.swift     # 1689 linhas — plugin Capacitor BLE
│   ├── Packages/RingParsers/         # SPM puro Swift
│   │   ├── Sources/RingParsers/
│   │   │   ├── Models/Sample.swift
│   │   │   ├── Common/{RingParser,Dispatcher}.swift
│   │   │   ├── JStyle/JStyleParser.swift  ✅ implementado + 13 testes
│   │   │   └── Colmi/ColmiParser.swift    ⚠ STUB
│   │   └── Tests/RingParsersTests/
│   │       ├── Fixtures/JStyle/      4 fixtures reais
│   │       ├── Fixtures/Colmi/       VAZIO — passo B vai popular
│   │       ├── FixtureRunner.swift
│   │       └── JStyleParserTests.swift
│   ├── fastlane/Fastfile             # lane :internal usa altool direto
│   └── vendor-sdks/                  # gitignored. Backup em Windows laptop
│       ├── X3 SDK/                   # JCRing Med X3 (lib arm64 only)
│       └── V5 SDK/                   # JCRing Care 2301 (lib fat)
├── src/                               # React/Vite
│   ├── hooks/useVYRStore.ts          # gate de onboarding em :217-323
│   └── wearables/jstyle/             # adapter TS (delega pra plugin nativo)
├── supabase/functions/               # edge functions (deploy via MCP)
│   └── vyr-compute-state/index.ts    # ⚠ NÃO existe localmente, só no Supabase
├── TODO.md                           # ESTE arquivo
└── vendor-sdks/README.md             # 3 paths de integração SDK
```

### Comandos úteis
```bash
# Rodar testes do pacote (5s, sem simulador)
cd ~/cognitive-architect/ios/Packages/RingParsers && swift test

# Build + deploy nova versão para TestFlight
cd ~/cognitive-architect && npm run build && npx cap sync ios && \
  cd ios && bundle exec fastlane ios internal

# Pegar dados real-time do banco (via MCP no Claude)
# select * from biomarker_samples where source='qring_ble' and ts > now() - interval '1 hour' order by ts desc

# SSH pro Windows laptop (Tailscale)
ssh dmg "cmd /c dir C:\\Users\\DiegoGuerra\\Downloads"

# Recompute score para um user específico (admin)
curl -X POST "https://uirbicdwikvgnuounlia.supabase.co/functions/v1/vyr-compute-state" \
  -H "x-admin-token: vyr-admin-2026-internal" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"<UUID>","day":"2026-05-02"}'
```

### IDs importantes
- Apple Vyr Supabase project: `uirbicdwikvgnuounlia`
- Android Vyr Supabase project: `eihnszqjscbfykuhjfpr`
- Diego user_id: `955c3cbb-acf0-464d-951f-ad05db653ca9`
- Lídia user_id: `e232cc43-407c-4aec-b084-2c7035d4e2c2`
- Daniele user_id: `19a6519a-ba89-43c0-a373-05657ffe8a7e`
- Admin token (vyr-compute-state): `vyr-admin-2026-internal`

### Memórias persistentes (Mac + Windows via Claude)
- `project_qring_architecture.md` — arquitetura ring stack rebuilt 2026-05-02
- `project_qring_protocol.md` — Colmi BLE protocol (Puxtril + Gadgetbridge)
- `project_qring_r09_state.md` — R09 specific findings
- `project_jstyle_sdk.md` — SDK J-Style oficial (X3 + V5/J2301A) recovered
- `project_vyr_supabase.md` — topologia 2 projects + ingestion traps
- `project_testflight_setup.md` — fastlane + altool bypass
- `project_tailscale_setup.md` — `dmg` (Windows) → `100.123.189.7`
