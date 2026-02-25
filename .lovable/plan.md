

## Problema Real

O `ENABLE_USER_SCRIPT_SANDBOXING = NO` foi aplicado apenas no **nível do Project** (configurações globais). Mas o Xcode também tem configurações no **nível do Target** (App), e o Target sobrescreve o Project. Como o Target não tem essa configuração explicitamente em `NO`, ele herda o default do Xcode (que é `YES` em versões recentes).

Fonte: StackOverflow confirma que a correção exige mudar em **ambos** -- Project e Target.

## Plano

### Arquivo: `ios/App/App.xcodeproj/project.pbxproj`

Adicionar `ENABLE_USER_SCRIPT_SANDBOXING = NO;` nas **duas** build configurations do **Target** App:

**1. Target Debug** (bloco `504EC3171FED79650016851F`, linha 378):
Adicionar dentro de `buildSettings`, por exemplo após `CLANG_ENABLE_MODULES = YES;`:

```
ENABLE_USER_SCRIPT_SANDBOXING = NO;
```

**2. Target Release** (bloco `504EC3181FED79650016851F`, linha 408):
Adicionar dentro de `buildSettings`, por exemplo após `CLANG_ENABLE_MODULES = YES;`:

```
ENABLE_USER_SCRIPT_SANDBOXING = NO;
```

### Resultado esperado

Com a configuração em NO nos 4 locais (Project Debug, Project Release, Target Debug, Target Release), o erro `Sandbox: bash deny(1) file-read-data` deve desaparecer definitivamente.

### Apos aplicar

1. `cd ios/App && pod deintegrate && pod install`
2. Abrir `App.xcworkspace`
3. Clean Build (Cmd+Shift+K)
4. Run (Cmd+R)

