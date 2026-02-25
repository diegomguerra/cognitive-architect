

## Analise do erro no Xcode

A screenshot mostra 3 problemas:

1. **Erro critico (vermelho):** `Sandbox: bash(69449) deny(1) file-read-data` — O Xcode esta bloqueando os scripts do CocoaPods de ler arquivos. Causa: `ENABLE_USER_SCRIPT_SANDBOXING = YES` no `project.pbxproj` (linhas de Debug e Release do Project).

2. **Warning:** `'HealthPlugin' is missing a dependency on 'Capacitor'` — O pacote SPM `CapApp-SPM` nao declara `Capacitor` como dependencia. O `@capgo/capacitor-health` (HealthPlugin) precisa do Capacitor como dependencia do modulo Swift.

3. **Warning:** `[CP] Embed Pods Frameworks` rodando a cada build — consequencia do sandbox bloqueando I/O.

## Plano de correcao (2 arquivos)

### 1. `ios/App/App.xcodeproj/project.pbxproj`

Mudar `ENABLE_USER_SCRIPT_SANDBOXING = YES` para `NO` nas **duas** build configurations do Project (Debug linha ~219 e Release linha ~252). Isso permite que os scripts do CocoaPods leiam arquivos no disco.

Locais exatos:
- Bloco `504EC3141FED79650016851F /* Debug */` (Project-level) — alterar `ENABLE_USER_SCRIPT_SANDBOXING = YES;` para `ENABLE_USER_SCRIPT_SANDBOXING = NO;`
- Bloco `504EC3151FED79650016851F /* Release */` (Project-level) — alterar `ENABLE_USER_SCRIPT_SANDBOXING = YES;` para `ENABLE_USER_SCRIPT_SANDBOXING = NO;`

### 2. `ios/debug.xcconfig`

Adicionar a linha para garantir que o xcconfig tambem desabilita o sandbox:

```
ENABLE_USER_SCRIPT_SANDBOXING = NO
```

### Resultado esperado

Apos essas mudancas:
- O erro `Sandbox: deny(1) file-read-data` desaparece
- Os scripts `[CP] Check Pods Manifest.lock` e `[CP] Embed Pods Frameworks` conseguem executar
- O warning do HealthPlugin pode persistir mas nao bloqueia o build

### Proximo passo apos o build

Clean Build (⌘+Shift+K) e depois Run (⌘+R) no device fisico.

