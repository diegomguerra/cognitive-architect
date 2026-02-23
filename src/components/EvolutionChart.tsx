import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface ChartData {
  date: string;
  score: number;
  energia: number;
  clareza: number;
  estabilidade: number;
}

interface EvolutionChartProps {
  data: ChartData[];
}

const EvolutionChart = ({ data }: EvolutionChartProps) => {
  return (
    <div className="rounded-2xl bg-card border border-border p-4">
      <h3 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium mb-4">Score (14 dias)</h3>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
          <Tooltip
            contentStyle={{
              background: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '8px',
              fontSize: '12px',
            }}
          />
          <Line type="monotone" dataKey="score" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="energia" stroke="hsl(var(--vyr-energia))" strokeWidth={1} dot={false} strokeDasharray="4 4" />
          <Line type="monotone" dataKey="clareza" stroke="hsl(var(--vyr-clareza))" strokeWidth={1} dot={false} strokeDasharray="4 4" />
          <Line type="monotone" dataKey="estabilidade" stroke="hsl(var(--vyr-estabilidade))" strokeWidth={1} dot={false} strokeDasharray="4 4" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default EvolutionChart;
