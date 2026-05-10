type Props = { className?: string };

/** [OPT] mark — substitui a coroa Oura na linguagem VYR. Só aparece para score 85+. */
export function ScoreMark({ className = '' }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-[10px] font-medium tracking-wide2 text-ds-bg0 bg-ds-ink0 px-2 py-[5px] rounded-[2px] ${className}`}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
        <path d="M1 7L0 2.5l2.5 2L5 0l2.5 4.5 2.5-2L9 7H1z" />
      </svg>
      OPT
    </span>
  );
}
