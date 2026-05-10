import { ChevronDown } from 'lucide-react';

type Props = {
  heading: string;
  body: string;
  onMore?: () => void;
};

/** Bloco editorial com heading grande + parágrafo + "Mais" toggle. Pattern Oura. */
export function EditorialBlock({ heading, body, onMore }: Props) {
  return (
    <section className="px-1 pb-6">
      <h2
        className="text-[30px] font-light tracking-[-0.025em] leading-[1.1] mb-3.5 text-ds-ink0"
        style={{ fontFamily: '"Inter Tight", Inter, sans-serif' }}
      >
        {heading}
      </h2>
      <p className="text-sm text-ds-ink1 leading-relaxed mb-3.5">{body}</p>
      {onMore && (
        <button
          type="button"
          onClick={onMore}
          className="font-mono text-[11px] tracking-wide2 text-ds-ink1 uppercase inline-flex items-center gap-1.5 border-b border-white/[0.15] pb-0.5 hover:text-ds-ink0 transition-colors"
        >
          Mais <ChevronDown size={12} />
        </button>
      )}
    </section>
  );
}
