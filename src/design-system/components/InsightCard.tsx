import type { ReactNode } from 'react';

type Variant = 'default' | 'risk' | 'positive' | 'neutral';

type Props = {
  label: string;            // "PADRÃO DETECTADO", "RISCO"
  text: ReactNode;
  variant?: Variant;
};

const BORDER_BY_VARIANT: Record<Variant, string> = {
  risk: 'border-l-ds-low',
  positive: 'border-l-ds-opt',
  neutral: 'border-l-ds-good',
  default: 'border-l-ds-ink0',
};

/** Card de insight com border-left colorida pela variant. */
export function InsightCard({ label, text, variant = 'default' }: Props) {
  return (
    <div className={`px-3.5 py-3.5 bg-white/[0.025] border-l-2 ${BORDER_BY_VARIANT[variant]} mt-4 mx-1 rounded-r-[2px]`}>
      <div className="font-mono text-[10px] tracking-wide3 text-ds-ink2 uppercase mb-2">
        {label}
      </div>
      <div className="text-[13px] text-ds-ink0 leading-[1.5]">{text}</div>
    </div>
  );
}
