import { getBand, getBandLabel, bandTextClass } from '../bands';
import { ScoreMark } from './ScoreMark';

type Props = {
  label: string;          // "VYR STATE", "ENERGIA"
  value: number;          // 0-100
  size?: 'lg' | 'md';     // lg=88px, md=64px
};

/**
 * HeroScore — número gigante mono + label + status uppercase + mark [OPT] se 85+.
 * Substitui StateRing nas telas Insights.
 */
export function HeroScore({ label, value, size = 'lg' }: Props) {
  const band = getBand(value);
  const numClass = size === 'lg' ? 'text-[88px]' : 'text-[64px]';

  return (
    <div className="border-b border-white/[0.08] pb-6 mb-6 px-1">
      <div className="font-mono text-[11px] tracking-wide3 text-ds-ink2 uppercase mb-3">
        {label}
      </div>
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
    </div>
  );
}
