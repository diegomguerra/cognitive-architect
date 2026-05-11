import { ChevronRight, AlertCircle } from 'lucide-react';
import { getBand, bandBgClass, bandTextClass } from '../bands';

type Props = {
  name: string;
  rawValue: string;        // "62 ms", "1h 28m" ou "—"
  score: number | null;    // null = sem dado válido
  qualityNote?: string;
  showScore?: boolean;
  onPress?: () => void;
};

/** ContributorRow com null-tolerance + qualityNote alert (Phase 2.5). */
export function ContributorRow({ name, rawValue, score, qualityNote, showScore = true, onPress }: Props) {
  const isNull = score === null;
  const isLow = !isNull && getBand(score) === 'low';
  const fillClass = isNull ? '' : bandBgClass(score);

  return (
    <button
      type="button"
      onClick={onPress}
      className="w-full text-left py-3.5 border-b border-white/[0.08] hover:opacity-85 transition"
    >
      <div className="flex justify-between items-baseline mb-2">
        <span className={`text-sm flex items-center gap-1.5 ${
          isLow ? bandTextClass(score!) : isNull ? 'text-ds-ink2' : 'text-ds-ink0'
        }`}>
          {name}
          {qualityNote && (
            <AlertCircle size={12} strokeWidth={1.5} className="text-ds-ink2" aria-label={qualityNote} />
          )}
        </span>
        <span
          className="flex items-baseline gap-2.5 font-mono text-[13px] text-ds-ink1"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          <span className={isLow ? bandTextClass(score!) : isNull ? 'text-ds-ink2' : 'text-ds-ink0'}>
            {rawValue}
          </span>
          {showScore && !isNull && <span className="text-ds-ink2">({score})</span>}
          {showScore && isNull && <span className="text-ds-ink3">(—)</span>}
          <ChevronRight size={14} className="text-ds-ink2 mt-0.5" />
        </span>
      </div>
      <div className="h-[2px] bg-white/[0.05] overflow-hidden rounded-[1px]">
        {!isNull ? (
          <div
            className={`h-full ${fillClass} transition-all duration-500`}
            style={{ width: `${Math.max(0, Math.min(100, score!))}%` }}
          />
        ) : (
          <div
            className="h-full w-full"
            style={{
              backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(82,82,82,0.3) 3px, rgba(82,82,82,0.3) 6px)',
            }}
          />
        )}
      </div>
      {qualityNote && (
        <div className="font-mono text-[10px] tracking-wide1 text-ds-ink2 mt-1.5 uppercase">
          {qualityNote}
        </div>
      )}
    </button>
  );
}
