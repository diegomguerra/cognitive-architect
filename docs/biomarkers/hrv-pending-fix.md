# HRV — Documentação do fix pendente (NÃO aplicado)

## Status atual
- 4 HRV samples nos últimos 14 dias (último: 2026-05-16 16:02 BRT, value=22).
- Anel JStyle X5 do Diego emite cmd 0x56 muito esporadicamente (0–2 packets/dia, alguns dias zero).
- HRV PPG-derived (via "Medir Agora") nunca foi gerado pra Diego.

## Bug identificado no parser (parse-vendor-raw v11)
`HRV_RECORD_SIZE = 12` está **errado**. Hex real do anel mostra records de **15 bytes**:

```
56 00 00 17 08 05 15 38 41 16 00 56 39 74 3D | 56 01 00 17 08 05 ...
[0]=cmd, [1]=idx, [2]=const, [3..8]=BCD(y/m/d/h/m/s), [9..14]=payload
```

Layout dos 6 bytes de payload (heurística):
- [9] = HRV RMSSD (valores 16–47)
- [10] = stress (mostly 0, ocasionalmente 0x14 = 20)
- [11] = HR (80–100 daytime)
- [12..14] = ainda não decifrado (HR pico? SDNN? checksum?)

Com record_size=12, parser lê pkt[12] esperando próximo cmd=0x56, mas encontra 0x39 → loop **quebra** → só extrai o primeiro record de cada packet. Idêntico ao bug que era em temp/steps/sleep antes do v11.

## Impacto se aplicado
- 4 packets × ~16 records = potencial de **64 HRV samples** (vs 4 hoje).
- **Caveat**: records antigos têm `yBCD = 0x17` (= 17 = 2017), clock do anel desincronizado pré-build-404. Fallback usa `recordTsMs` → 16 records colidiriam no `biomarker_dedup_unique`.

## Fix proposto (parse-vendor-raw v12, isolado)

```ts
const HRV_RECORD_SIZE = 15; // corrigido de 12

function parseJStyleHRV(b: number[], recordTsMs: number): ParsedSample[] {
  const out: ParsedSample[] = [];
  if (b.length < HRV_RECORD_SIZE) return out;
  const cmdByte = b[0];
  let i = 0;
  let recIdx = 0;
  while (i + HRV_RECORD_SIZE <= b.length) {
    const rec = b.slice(i, i + HRV_RECORD_SIZE);
    if (rec[0] !== cmdByte) break;
    if (rec[1] === 0xFF) { i += HRV_RECORD_SIZE; continue; }
    const r = parseDateOrFallback(rec, 3, 4, 5, 6, 7, recordTsMs, 8);
    // Quando date BCD inválida (year < 2024), offset por recIdx pra evitar
    // colisão no dedup_unique. 1s por record preserva ordem sem fingir
    // que são intervalos reais de 30min.
    const tsMs = r.isFallback ? r.date.getTime() + recIdx * 1000 : r.date.getTime();
    const hrv = rec[9], stress = rec[10], hr = rec[11];
    if (hrv >= 5 && hrv <= 250) out.push({ type: "hrv", ts: new Date(tsMs).toISOString(), value: hrv, payload_json: { mode: "jstyle_history", packet_idx: rec[1], record_offset_idx: recIdx, ts_from_record_fallback: r.isFallback } });
    if (stress >= 1 && stress <= 100) out.push({ type: "stress", ts: new Date(tsMs + 1).toISOString(), value: stress, payload_json: { mode: "jstyle_history", packet_idx: rec[1], record_offset_idx: recIdx, ts_from_record_fallback: r.isFallback } });
    if (hr >= 30 && hr <= 220) out.push({ type: "hr", ts: new Date(tsMs + 2).toISOString(), value: hr, payload_json: { mode: "jstyle_hrv_record", packet_idx: rec[1], record_offset_idx: recIdx, ts_from_record_fallback: r.isFallback } });
    i += HRV_RECORD_SIZE;
    recIdx++;
  }
  return out;
}
```

## Plano de isolamento

Diferente de temp/steps/sleep (fixados in-place no v11), o HRV terá **caveats únicos**:
- Clock desincronizado nos packets antigos → timestamps "fake" (offset por recIdx)
- Records pós-build-404 (com clock correto) terão timestamps reais
- Risco baixo de regredir temp/steps/sleep (mudança escopada à função parseJStyleHRV)

Estratégia: **deploy v12 quando concordado**, separado do build mobile 405. Mudança contida em parseJStyleHRV — não toca outros parsers.

## Por que NÃO está sendo aplicado agora
- Diego pediu pra não comprometer ganhos de outros biomarcadores antes de validar isoladamente.
- Apesar do fix ser localizado, ele introduz timestamps sintéticos (recordTsMs + recIdx*1000) que poluem o dataset com leituras que não correspondem ao momento real da medição.
- Melhor caminho: investigar primeiro por que o anel **não está emitindo cmd 0x56** com frequência (provavelmente bug de SetAutomatic em algum dataType, ou anel precisa de cmd adicional pra ativar HRV contínuo). Resolver isso traz packets NOVOS com clock correto, eliminando a necessidade do fallback recIdx.

## Próximos passos pendentes (registrar)
1. Investigar por que anel emite 0x56 raramente (1-2/dia vs HR 100+/dia).
2. Checar se SetAutomatic dataType=4 está sendo aceito pelo anel (Diego sync logs).
3. Considerar trigger automático de "Medir Agora" em background a cada N horas pra capturar HRV via PPG.
4. Após (1)–(3), avaliar se v12 com record_size=15 ainda é necessário.
