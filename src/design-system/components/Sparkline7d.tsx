import { bandBgClass } from '../bands';

type Day = { label: string; score: number };
type Props = { days: Day[]; avg?: number };

/** Mini histograma horizontal de 7 dias. Cada barra colorida pela faixa do score. */
export function Sparkline7d({ days, avg }: Props) {
  if (!days || days.length === 0) return null;

  return (
    <section className="px-1 pt-6 border-t border-white/[0.08] mt-2">
      <div className="flex justify-between items-baseline mb-4">
        <span className="font-mono text-[11px] tracking-wide2 text-ds-ink2 uppercase">
          Últimos {days.length} dias
        </span>
        {typeof avg === 'number' && (
          <span className="font-mono text-[11px] text-ds-ink1 tracking-wide1">
            méd {avg.toFixed(1)}
          </span>
        )}
      </div>
      <div
        className="grid gap-2 items-end h-16"
        style={{ gridTemplateColumns: `repeat(${days.length}, 1fr)` }}
      >
        {days.map((d, i) => (
          <div key={`${d.label}-${i}`} className="flex flex-col items-center gap-1.5 h-full justify-end">
            <span
              className={`w-full ${bandBgClass(d.score)} rounded-[1px]`}
              style={{ height: `${Math.max(2, d.score)}%` }}
            />
            <span className="font-mono text-[11px] text-ds-ink2" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {d.score}
            </span>
            <span className="font-mono text-[9px] text-ds-ink3 tracking-wide1 uppercase mt-0.5">
              {d.label}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
