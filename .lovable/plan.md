

## Aplicar correção no `ios/debug.xcconfig`

### Arquivo: `ios/debug.xcconfig`

Substituir o conteúdo atual por:

```
#include "App/Pods/Target Support Files/Pods-App/Pods-App.debug.xcconfig"
// Configuration settings file format documentation can be found at:
// https://help.apple.com/xcode/#/dev745c5c974
ENABLE_USER_SCRIPT_SANDBOXING = NO
```

Única mudança: adicionar a linha `#include` no topo.

### Após o deploy, o Bruno roda:

```bash
git pull
npx cap sync ios
cd ios/App
pod install
open App.xcworkspace
```

No Xcode: `⌘+Shift+K` (Clean) → `⌘+R` (Run)

