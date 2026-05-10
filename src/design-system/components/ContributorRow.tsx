import { ChevronRight } from 'lucide-react';
import { getBand, bandBgClass, bandTextClass } from '../bands';

type Props = {
  name: string;
  rawValue: string;        // "62 ms", "1h 28m", "5h 12m"
  score: number;           // 0-100
  showScore?: boolean;
  onPress?: () => void;
};

/** Linha de contribuidor com nome, valor raw, score numerico e barra fina horizontal. */
export function ContributorRow({ name, rawValue, score, showScore = true, onPress }: Props) {
  const isLow = getBand(score) === 'low';
  const fillClass = bandBgClass(score);

  return (
    <button
      type="button"
      onClick={onPress}
      className="w-full text-left py-3.5 border-b border-white/[0.08] hover:opacity-85 transition"
    >
      <div className="flex justify-between items-baseline mb-2">
        <span className={`text-sm ${isLow ? bandTextClass(score) : 'text-ds-ink0'}`}>{name}</span>
        <span
          className="flex items-baseline gap-2.5 font-mono text-[13px] text-ds-ink1"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          <span className={isLow ? bandTextClass(score) : 'text-ds-ink0'}>{rawValue}</span>
          {showScore && <span className="text-ds-ink2">({score})</span>}
          <ChevronRight size={14} className="text-ds-ink2 mt-0.5" />
        </span>
      </div>
      <div className="h-[2px] bg-white/[0.05] overflow-hidden rounded-[1px]">
        <div className={`h-full ${fillClass} transition-all duration-500`} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
      </div>
    </button>
  );
}
