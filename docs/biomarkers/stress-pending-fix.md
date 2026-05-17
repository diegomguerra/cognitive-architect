# Estresse — Documentação do fix pendente (NÃO aplicado)

## Status atual
- **Zero stress samples** no DB nos últimos 14 dias.
- Card mostra "74 · 16/05" via fallback derivado de HRV: `100 - hrv*1.2` (HRV=22 último 16/05 → stress=74).
- Timestamp herdado do HRV → mesma staleness.

## Root cause
**Mesma raiz do HRV** — ver `docs/biomarkers/hrv-pending-fix.md`.

`parseJStyleHRV` em parse-vendor-raw v11 usa `HRV_RECORD_SIZE = 12` mas records reais têm 15 bytes. Parser quebra após o primeiro record. Stress (`rec[10]`) é zero nos primeiros records do Diego mas tem valores válidos a partir do `idx 17`:

```
56 17 ... 14 47 ...  → stress=0x14=20 ✓
56 18 ... 14 4A ...  → stress=20 ✓
56 1D ... 0F 4E ...  → stress=15 ✓
```

Esses nunca são alcançados pelo loop atual.

## Fix proposto
**Mesma mudança do HRV** — corrigir `HRV_RECORD_SIZE = 15` em parse-vendor-raw v12. Sem mudança adicional necessária para stress.

Impacto esperado:
- 4 packets × ~16 records = ~64 records iterados
- Estimativa: ~20% com stress válido = ~13 stress samples retroativos do Diego
- Records pós-build-404 (anel com clock correto) adicionariam stress fresco quando emitidos

## Por que NÃO está sendo aplicado agora
- Bloqueado pelo mesmo conjunto de validações do HRV: anel emite cmd 0x56 raramente, fix do parser desbloqueia mas não resolve a baixa frequência de medições.
- Aplicar HRV automaticamente conserta Estresse — não há fix isolado para Estresse.

## Fallback atual no frontend (mantido)
- Stress derivado de HRV via `100 - hrv*1.2` (em `BiomarkersGrid.tsx` `stressFinal`)
- Funciona mas herda staleness do HRV
- Quando HRV estiver fresco, stress derivado também ficará
