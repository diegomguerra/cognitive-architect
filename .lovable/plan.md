## Correção Capacitor 8 — Plugin Registration

### Feito pelo Lovable
1. `AppDelegate.swift` — removido `CAPBridge.registerPlugin(VYRHealthBridge.self)`
2. `MyViewController.swift` — criado com `capacitorDidLoad()` registrando o plugin

### O que o Bruno faz no Mac

```text
1. git pull
2. npx cap sync ios
3. cd ios/App && pod install
4. open App.xcworkspace

No Xcode:
5. Botão direito no grupo "App" → "Add Files to App..."
   → Selecionar VYRHealthBridge.swift e MyViewController.swift
   → Confirmar "Add to target: App" marcado

6. Abrir Main.storyboard
   → Clicar no ViewController
   → Identity Inspector → Custom Class → "MyViewController"

7. ⌘+Shift+K (Clean Build)
8. ⌘+R (Run)
```
