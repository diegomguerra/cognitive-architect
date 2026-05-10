import { bandTextClass, getBandLabel } from '../bands';

type Props = {
  label: string;          // "Energia", "Clareza", "Estabilidade"
  value: number;          // 0-100
  onClick?: () => void;
};

/** Card de índice usado no grid 3-col da TodayScreen. */
export function IndexCard({ label, value, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left p-[18px_14px] bg-ds-bg2 border border-white/[0.08] rounded-[4px] hover:border-white/[0.15] transition-colors"
    >
      <div className="font-mono text-[10px] tracking-wide2 text-ds-ink2 uppercase mb-3.5">
        {label}
      </div>
      <div
        className="font-mono text-[34px] font-normal tracking-[-0.03em] leading-none mb-2 text-ds-ink0"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </div>
      <div className={`font-mono text-[9px] tracking-wide2 uppercase ${bandTextClass(value)}`}>
        {getBandLabel(value)}
      </div>
    </button>
  );
}
