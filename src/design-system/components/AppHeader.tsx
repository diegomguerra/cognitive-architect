import { Bell, User, ArrowLeft } from 'lucide-react';
import { RingStatusBadge } from './RingStatusBadge';

type Props = {
  variant?: 'home' | 'detail';
  title?: string;
  onBack?: () => void;
};

/** App header global — VYR LABS + ring status + bell + user (home) ou back + title (detail). */
export function AppHeader({ variant = 'home', title, onBack }: Props) {
  if (variant === 'detail') {
    return (
      <div className="flex justify-between items-center px-1 pt-2 pb-3">
        <button onClick={onBack} className="w-8 h-8 flex items-center justify-center text-ds-ink1 hover:text-ds-ink0">
          <ArrowLeft size={20} strokeWidth={1.5} />
        </button>
        <span className="font-mono text-[12px] tracking-wide3 text-ds-ink0 uppercase">{title}</span>
        <div className="w-8 h-8" />
      </div>
    );
  }

  return (
    <div className="flex justify-between items-center px-1 pt-2 pb-3">
      <span className="font-mono text-[11px] font-medium tracking-wide3 text-ds-ink0">VYR LABS</span>
      <div className="flex gap-1 items-center">
        <RingStatusBadge />
        <button className="w-8 h-8 flex items-center justify-center text-ds-ink1 hover:text-ds-ink0">
          <Bell size={16} strokeWidth={1.5} />
        </button>
        <button className="w-8 h-8 flex items-center justify-center text-ds-ink1 hover:text-ds-ink0">
          <User size={16} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
