# RR Intervals — Documentação do fix pendente (NÃO aplicado)

## Status atual
- 20 RR samples nos últimos 14 dias, último em **2026-05-10 23:13 BRT** (7 dias stale).
- Único source: `parse_vendor_raw` (derivado de PPG via `computePPGAggregates`).
- 3950 PPG samples existem em 16/05 22:49 UTC (78.7s de "Medir Agora"), mas geraram **ZERO RR**.

## Root cause identificado

Inspeção visual dos PPG values raw do 16/05 mostra **sinal multi-canal interleaved**:

```
459765, 459629, 459732, 459731   ← baseline ~460k
2306662, 440640, 2321215, 439433  ← alternando high/low
2716481, 2715189, 2712265          ← baseline ~2.7M
461958, 462111                     ← baseline ~462k
```

O anel JStyle X5 emite PPG via cmd 0x3A com múltiplos canais (provavelmente LED verde + vermelho/IR sampleados alternadamente). O parser `parseJStylePPG` lê 3 bytes por sample sem separar canais → sinal mixto.

Consequência em `computePPGAggregates`:
- AC range = 6.5M (gigante, por causa do mix entre canais)
- Threshold = `acMin + range * 0.55` = +1.31M (alto demais)
- Peaks detectados não correspondem a batimentos reais
- Função bail em `peaks.length < 4` ou produz peaks com RR fora de [300, 1500]ms → `rr.length < 3` → return []

## Fix proposto (parse-vendor-raw v12 ou separado)

**Opção A — Separar canais no parser**
- Investigar via "Medir Agora" diagnostic mode quantos LEDs/canais o anel emite por frame
- `parseJStylePPG` precisa retornar arrays separados por canal (ppg_green, ppg_red, ppg_ir)
- `computePPGAggregates` roda no canal de melhor SNR (geralmente verde)

**Opção B — Filtro de canal único (heurística)**
- Detectar canais via clusterização dos valores (k-means k=2 na amplitude)
- Selecionar cluster com SD menor (mais estável = canal de pulse)
- Aplicar peak detection apenas neste cluster

**Opção C — Substituir algoritmo**
- Usar Pan-Tompkins ou filtro Butterworth bandpass [0.5, 5]Hz antes do peak detection
- Mais robusto a sinais ruidosos / multi-canal

## Plano de isolamento

Mudança no `parseJStylePPG` afeta:
- ✅ PPG raw count (ainda emite por canal)
- ✅ HR/HRV/RR derivados (passariam a usar canal limpo)
- ⚠️ Re-parse retroativo necessário para popular RR histórico

Mantido isolado: parser de outros cmds (0x54 HR, 0x66 SpO2, etc) não muda. Risco baixo.

## Por que NÃO está sendo aplicado agora
- Decodificação do formato multi-channel precisa de **engenharia reversa via SDK ou capture controlado** (Diego registra "Medir Agora" com dedo sobre/fora do sensor pra correlacionar canais).
- Sem SDK reference, hipóteses sobre layout (cluster, intervalo de canais) podem corromper PPG raw para outros usos.
- Solução temporária: card RR pode aceitar fallback para HR variability via cmd 0x56 (HRV packet contém HR adicional).

## Próximos passos pendentes (registrar)
1. Capture controlado de PPG de 60s pra confirmar layout multi-canal.
2. Decodificar estrutura via libBleSDK.a disassembly (procurar `getPpgData` ou similar).
3. Implementar opção A no `parseJStylePPG` após confirmar layout.
4. Re-parse retroativo de TODO PPG existente (~17k samples 10/05 + 4k 16/05).
5. Validar RR plausível (300-1500ms = 40-200 bpm equivalente).
