import { getBand, getBandLabel, bandTextClass } from '../bands';
import { ScoreMark } from './ScoreMark';

type Props = {
  label: string;
  value: number | null;       // null = sem dado
  size?: 'lg' | 'md';
  freshnessNote?: string;     // "Atualizado há 2h" ou "Sem dados desde 30/abr"
};

/** HeroScore com null-over-fake. Mostra estado vazio honesto se value === null. */
export function HeroScore({ label, value, size = 'lg', freshnessNote }: Props) {
  const numClass = size === 'lg' ? 'text-[88px]' : 'text-[64px]';

  if (value === null) {
    return (
      <div className="border-b border-white/[0.08] pb-6 mb-6 px-1">
        <div className="font-mono text-[11px] tracking-wide3 text-ds-ink2 uppercase mb-3">{label}</div>
        <div
          className={`font-mono ${numClass} font-light leading-[0.92] tracking-[-0.045em] text-ds-ink3`}
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          —
        </div>
        <div className="font-mono text-[11px] tracking-wide3 uppercase mt-3 text-ds-ink2">
          Dados insuficientes
        </div>
        <p className="text-sm text-ds-ink2 mt-3 leading-relaxed">
          Use o anel mais 2 noites pra estabelecer baseline.
        </p>
      </div>
    );
  }

  const band = getBand(value);
  return (
    <div className="border-b border-white/[0.08] pb-6 mb-6 px-1">
      <div className="font-mono text-[11px] tracking-wide3 text-ds-ink2 uppercase mb-3">{label}</div>
      <div className="flex items-start gap-4">
        <div
          className={`font-mono ${numClass} font-normal leading-[0.92] tracking-[-0.045em] text-ds-ink0`}
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {value}
        </div>
        {band === 'opt' && <ScoreMark className="mt-2" />}
      </div>
      <div className={`font-mono text-[11px] tracking-wide3 uppercase mt-3 ${bandTextClass(value)}`}>
        {getBandLabel(value)}
      </div>
      {freshnessNote && (
        <div className="font-mono text-[10px] tracking-wide1 uppercase mt-2 text-ds-ink2">
          {freshnessNote}
        </div>
      )}
    </div>
  );
}
