

## Plano de execução

### 1. Editar `ios/App/App/AppDelegate.swift`
Remover `CAPBridge.registerPlugin(VYRHealthBridge.self)` do `didFinishLaunchingWithOptions`, mantendo apenas `return true`.

### 2. Criar `ios/App/App/MyViewController.swift`
Novo arquivo com `CAPBridgeViewController` subclass que registra o plugin via `bridge?.registerPluginInstance(VYRHealthBridge())` em `capacitorDidLoad()`.

### 3. Atualizar `.lovable/plan.md`
Documentar os passos manuais que o Bruno precisa fazer no Xcode após `git pull`.

---

### O que o Bruno faz no Mac após o deploy

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

