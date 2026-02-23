import { Lightbulb, AlertCircle, TrendingUp } from 'lucide-react';

type InsightType = 'insight' | 'warning' | 'positive';

interface InsightCardProps {
  type: InsightType;
  title: string;
  description: string;
}

const config: Record<InsightType, { icon: typeof Lightbulb; colorVar: string }> = {
  insight: { icon: Lightbulb, colorVar: '--vyr-accent-action' },
  warning: { icon: AlertCircle, colorVar: '--vyr-accent-transition' },
  positive: { icon: TrendingUp, colorVar: '--vyr-accent-stable' },
};

const InsightCard = ({ type, title, description }: InsightCardProps) => {
  const { icon: Icon, colorVar } = config[type];

  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: `hsl(var(${colorVar}) / 0.05)`,
        border: `1px solid hsl(var(${colorVar}) / 0.3)`,
      }}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 rounded-lg p-2 bg-vyr-bg-surface/50">
          <Icon size={20} style={{ color: `hsl(var(${colorVar}))` }} />
        </div>
        <div className="min-w-0">
          <h4 className="text-sm font-medium text-vyr-text-primary">{title}</h4>
          <p className="text-xs text-vyr-text-secondary mt-1 leading-relaxed">{description}</p>
        </div>
      </div>
    </div>
  );
};

export default InsightCard;
