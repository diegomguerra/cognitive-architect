

## Correção de Indentação no project.pbxproj

### Contexto
- Você **abre** o `App.xcworkspace` no Xcode (correto)
- As **configurações de build** ficam dentro do `project.pbxproj` (é onde editamos)
- São camadas complementares, não conflitantes

### Problema
O diff anterior mostra que as linhas 380-388 (Target Debug) e 411-419 (Target Release) perderam 1 nível de indentação — estão com 3 tabs em vez de 4 tabs como o restante do bloco `buildSettings`.

### Plano

**Arquivo: `ios/App/App.xcodeproj/project.pbxproj`**

Restaurar a indentação correta (4 tabs) nas linhas afetadas, mantendo o `ENABLE_USER_SCRIPT_SANDBOXING = NO` que já foi adicionado:

**Target Debug (linhas ~380-388)** — de 3 tabs para 4 tabs:
```
				CLANG_ENABLE_MODULES = YES;
				CODE_SIGN_ENTITLEMENTS = App/App.entitlements;
				CODE_SIGN_IDENTITY = "Apple Development";
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				DEVELOPMENT_TEAM = WNB4G5T7Z6;
				ENABLE_USER_SCRIPT_SANDBOXING = NO;
				INFOPLIST_FILE = App/Info.plist;
				IPHONEOS_DEPLOYMENT_TARGET = 15.0;
```

**Target Release (linhas ~411-419)** — mesma correção.

### Após aplicar
1. No terminal (já em `ios/App/`): `open App.xcworkspace`
2. Clean Build: `⌘ + Shift + K`
3. Run: `⌘ + R`

