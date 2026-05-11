import { useState } from 'react';
import { X } from 'lucide-react';
import { useTags, FIXED_TAGS } from './use-tags';
import { TagPill } from '@/design-system/components/TagPill';

type Props = {
  day: string;
  open: boolean;
  onClose: () => void;
};

export function TagInputModal({ day, open, onClose }: Props) {
  const { add } = useTags(day);
  const [custom, setCustom] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const onSelectFixed = async (code: string) => {
    setSaving(true);
    try { await add(code, comment.trim() || undefined); onClose(); setComment(''); }
    finally { setSaving(false); }
  };

  const onSubmitCustom = async () => {
    if (!custom.trim()) return;
    setSaving(true);
    const code = custom.trim().toLowerCase().replace(/\s+/g, '_').slice(0, 32);
    try { await add(code, comment.trim() || undefined); onClose(); setCustom(''); setComment(''); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full bg-ds-bg1 border-t border-white/[0.1] rounded-t-2xl px-5 pt-5 pb-8 max-h-[80dvh] overflow-y-auto"
        style={{ animation: 'slide-up 250ms ease-out' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-5">
          <span className="font-mono text-[11px] tracking-wide3 uppercase text-ds-ink1">Adicionar tag</span>
          <button onClick={onClose} className="text-ds-ink2 hover:text-ds-ink0">
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        <div className="font-mono text-[10px] tracking-wide2 uppercase text-ds-ink2 mb-3">Sugestões</div>
        <div className="flex flex-wrap gap-1.5 mb-6">
          {FIXED_TAGS.map((t) => (
            <TagPill key={t.code} label={t.label} onPress={() => onSelectFixed(t.code)} />
          ))}
        </div>

        <div className="font-mono text-[10px] tracking-wide2 uppercase text-ds-ink2 mb-2">Personalizada</div>
        <input
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="ex: viagem, jejum, terapia"
          maxLength={32}
          className="w-full bg-transparent border-b border-white/[0.15] text-ds-ink0 text-sm py-2 mb-4 focus:outline-none focus:border-ds-ink0"
          style={{ fontFamily: 'Inter, sans-serif' }}
        />

        <div className="font-mono text-[10px] tracking-wide2 uppercase text-ds-ink2 mb-2">Comentário (opcional)</div>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          maxLength={140}
          placeholder="contexto rápido"
          className="w-full bg-transparent border border-white/[0.1] rounded-[3px] p-2 text-ds-ink0 text-sm focus:outline-none focus:border-white/[0.25]"
          style={{ fontFamily: 'Inter, sans-serif' }}
        />

        <button
          onClick={onSubmitCustom}
          disabled={saving || !custom.trim()}
          className="w-full mt-5 py-3 bg-ds-ink0 text-ds-bg0 rounded-[3px] font-mono text-[11px] tracking-wide2 uppercase disabled:opacity-30"
        >
          {saving ? 'Salvando…' : 'Adicionar'}
        </button>
      </div>
    </div>
  );
}
