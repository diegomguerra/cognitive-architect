import { BAND_COLORS, BAND_LABELS, BAND_RANGES, type Band } from '../bands';

const ORDER: Band[] = ['opt', 'good', 'fair', 'low'];

/** Legenda das 4 faixas. Usada em Insights/profile/educational. */
export function BandLegend() {
  return (
    <div className="flex gap-4 flex-wrap text-[11px] font-mono text-ds-ink1 tracking-wide1">
      {ORDER.map((b) => {
        const r = BAND_RANGES[b];
        const range = b === 'low' ? '<60' : `${r.min}+${b === 'opt' ? '' : `–${r.max}`}`;
        return (
          <span key={b} className="flex items-center gap-2">
            <i className="inline-block w-2.5 h-2.5 rounded-[1px]" style={{ background: BAND_COLORS[b] }} />
            {BAND_LABELS[b]} · {range}
          </span>
        );
      })}
    </div>
  );
}
