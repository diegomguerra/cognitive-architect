import { X } from 'lucide-react';

type Props = {
  label: string;
  active?: boolean;
  removable?: boolean;
  onPress?: () => void;
  onRemove?: () => void;
};

/** Pill de tag — outline mono caps, com X removível opcional. */
export function TagPill({ label, active = false, removable = false, onPress, onRemove }: Props) {
  return (
    <span
      onClick={onPress}
      role={onPress ? 'button' : undefined}
      tabIndex={onPress ? 0 : undefined}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-[10px] tracking-wide2 uppercase border transition-colors ${
        active
          ? 'border-ds-ink0 text-ds-ink0 bg-white/[0.04]'
          : 'border-white/[0.15] text-ds-ink2 hover:border-ds-ink1 hover:text-ds-ink1'
      } ${onPress ? 'cursor-pointer' : ''}`}
    >
      {label}
      {removable && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove?.();
          }}
          className="text-ds-ink2 hover:text-ds-ink0 -mr-0.5"
          aria-label="Remover tag"
        >
          <X size={10} strokeWidth={2} />
        </button>
      )}
    </span>
  );
}
