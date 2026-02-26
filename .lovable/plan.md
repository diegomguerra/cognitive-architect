

## Plano: Gerar ícone 1024x1024 para o App Store

O app já tem o `src/assets/brain-icon.png` (logo do cérebro) e usa tema escuro com tons de azul-cinza. Vou criar uma edge function temporária que usa a API de geração de imagem para criar um ícone de app 1024x1024 no estilo VYR Labs.

### O que vou fazer

1. **Criar edge function `generate-app-icon`** que chama a API de imagem (Gemini) com um prompt descrevendo o ícone: fundo escuro (#0f1114), símbolo de cérebro minimalista em tons de azul-acinzentado, estilo clean para app icon iOS, sem texto, cantos arredondados
2. **Salvar a imagem gerada** como base64 e retornar para download
3. **Chamar a function** e disponibilizar o resultado para você baixar e usar no Xcode

Depois de gerar e baixar, a function pode ser removida.

### Alternativa mais rápida

Se preferir, você pode usar o próprio `src/assets/brain-icon.png` existente e redimensionar para 1024x1024 usando o Preview.app do Mac (Ferramentas → Ajustar Tamanho → 1024x1024). Ou usar https://appicon.co para gerar todos os tamanhos a partir dele.

