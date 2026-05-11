type Props = { date?: Date | string };

/**
 * Linha de data UPPERCASE mono — "SÁB · 10 MAI 2026".
 * Aceita string YYYY-MM-DD (parseada como local pra evitar bug timezone UTC).
 */
export function DateRow({ date }: Props) {
  const localDate = (() => {
    if (date == null) return new Date();
    if (date instanceof Date) return date;
    // YYYY-MM-DD parseado como local midnight (não UTC)
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return new Date(date);
  })();
  const formatted = localDate.toLocaleDateString('pt-BR', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  }).replace(/\./g, '').replace(',', ' ·').toUpperCase();

  return (
    <div className="font-mono text-[11px] tracking-wide2 text-ds-ink2 text-center uppercase mb-6">
      {formatted}
    </div>
  );
}
