

## Diagnóstico

### 1. `.github/workflows/sync-repo.yml`
Este workflow sincroniza para um repositório destino usando secrets `DEST_REPO` e `DEST_REPO_TOKEN`. Se esses secrets não estão configurados, a URL fica `https://github.com/.git` e o workflow falha. Deve ser **deletado**.

### 2. `.github/workflows/ios-build.yml`
Conteúdo atual (já atualizado nas edições anteriores):

```yaml
name: iOS Build & TestFlight

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: npm install

      - name: Install Capacitor CLI
        run: npx cap --version || npm install -g @capacitor/cli

      - name: Sync Capacitor
        run: npx cap sync ios

      - name: Install CocoaPods
        run: |
          cd ios/App
          pod install

      - name: Build iOS
        run: |
          xcodebuild -workspace ios/App/App.xcworkspace \
            -scheme App \
            -configuration Release \
            -destination generic/platform=iOS \
            CODE_SIGN_IDENTITY="" \
            CODE_SIGNING_REQUIRED=NO \
            CODE_SIGNING_ALLOWED=NO \
            build
```

Este workflow está correto para validar compilação sem signing.

## Plano de execução

| Arquivo | Ação |
|---|---|
| `.github/workflows/sync-repo.yml` | **Deletar** completamente |

Apenas uma alteração: deletar o arquivo de sync. O `ios-build.yml` já está no estado correto e não precisa de mudanças.

