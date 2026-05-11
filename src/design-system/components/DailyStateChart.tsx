import { SachetGlyph } from './SachetGlyph';

export type HourlyPoint = { hour: number; hrAvg: number | null; hrMin: number | null; hrMax: number | null };
export type SachetMarker = { hour: number; type: 'BOOT' | 'HOLD' | 'CLEAR' };

type Props = {
  hourly: HourlyPoint[];
  sachets: SachetMarker[];
};

/** Linha 24h de HR + faixa min/max + marcadores de sachet. */
export function DailyStateChart({ hourly, sachets }: Props) {
  const W = 320;
  const H = 140;
  const padL = 28;
  const padR = 8;
  const padT = 12;
  const padB = 22;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const valid = hourly.filter((p) => p.hrAvg != null);
  const allValues = valid.flatMap((p) => [p.hrAvg!, p.hrMin ?? p.hrAvg!, p.hrMax ?? p.hrAvg!]);
  const yMin = allValues.length ? Math.floor(Math.min(...allValues) / 10) * 10 : 50;
  const yMax = allValues.length ? Math.ceil(Math.max(...allValues) / 10) * 10 : 100;
  const yRange = Math.max(10, yMax - yMin);

  const x = (h: number) => padL + (h / 24) * innerW;
  const y = (v: number) => padT + (1 - (v - yMin) / yRange) * innerH;

  const linePath = valid
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.hour).toFixed(1)} ${y(p.hrAvg!).toFixed(1)}`)
    .join(' ');

  const bandPath = (() => {
    if (valid.length === 0) return '';
    const top = valid.map((p) => `${x(p.hour).toFixed(1)},${y(p.hrMax ?? p.hrAvg!).toFixed(1)}`).join(' ');
    const bot = [...valid].reverse().map((p) => `${x(p.hour).toFixed(1)},${y(p.hrMin ?? p.hrAvg!).toFixed(1)}`).join(' ');
    return `M ${top} L ${bot} Z`;
  })();

  return (
    <div className="bg-ds-bg2 border border-white/[0.08] rounded-[4px] p-3">
      <svg width="100%" height={H + 20} viewBox={`0 0 ${W} ${H + 20}`} preserveAspectRatio="none">
        {/* y-axis labels */}
        <text x={4} y={padT + 4} fill="#666" fontSize="9" fontFamily="JetBrains Mono, monospace">{yMax}</text>
        <text x={4} y={padT + innerH + 2} fill="#666" fontSize="9" fontFamily="JetBrains Mono, monospace">{yMin}</text>

        {/* x-axis labels */}
        {[0, 6, 12, 18, 24].map((h) => (
          <text
            key={h}
            x={x(h)}
            y={H - 6}
            fill="#666"
            fontSize="9"
            textAnchor="middle"
            fontFamily="JetBrains Mono, monospace"
          >
            {h.toString().padStart(2, '0')}h
          </text>
        ))}

        {/* min/max band */}
        {bandPath && <path d={bandPath} fill="rgba(255,255,255,0.06)" />}

        {/* avg line */}
        {linePath && <path d={linePath} stroke="#E5E5E5" strokeWidth="1.25" fill="none" strokeLinejoin="round" strokeLinecap="round" />}

        {/* dots */}
        {valid.map((p) => (
          <circle key={p.hour} cx={x(p.hour)} cy={y(p.hrAvg!)} r="1.6" fill="#E5E5E5" />
        ))}

        {/* sachet markers */}
        {sachets.map((s, i) => (
          <g key={`${s.type}-${i}`} transform={`translate(${x(s.hour) - 7} ${H + 2})`}>
            <foreignObject width="14" height="14">
              <SachetGlyph type={s.type} size={14} />
            </foreignObject>
          </g>
        ))}
      </svg>
    </div>
  );
}
