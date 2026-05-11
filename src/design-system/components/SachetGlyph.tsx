type Props = {
  type: 'BOOT' | 'HOLD' | 'CLEAR';
  size?: number;
};

/** Glyph SVG simples diferenciando os 3 sachets. */
export function SachetGlyph({ type, size = 14 }: Props) {
  const color = type === 'BOOT' ? '#FFB85C' : type === 'HOLD' ? '#7CC4FF' : '#A89CFF';
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-label={`Sachet ${type}`}>
      {type === 'BOOT' && <circle cx="7" cy="7" r="5" stroke={color} strokeWidth="1.5" />}
      {type === 'HOLD' && <rect x="2.5" y="2.5" width="9" height="9" stroke={color} strokeWidth="1.5" />}
      {type === 'CLEAR' && (
        <polygon points="7,2 12,12 2,12" stroke={color} strokeWidth="1.5" fill="none" />
      )}
    </svg>
  );
}
