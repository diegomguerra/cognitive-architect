import { useState } from 'react';
import { X } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import type { DoseType } from '@/lib/vyr-engine';

interface DosePerceptionModalProps {
  doseType: DoseType;
  onConfirm: (data: {
    perceived_feeling: number;
    perceived_energy: number;
    perceived_clarity: number;
    notes: string;
  }) => Promise<void>;
  onClose: () => void;
}

const doseConfig: Record<DoseType, { label: string; color: string }> = {
  BOOT: { label: 'BOOT', color: '#F59E0B' },
  HOLD: { label: 'HOLD', color: '#F59E0B' },
  CLEAR: { label: 'CLEAR', color: '#1E293B' },
};

const scaleLabels: Record<number, string> = {
  1: 'Muito baixo',
  2: 'Baixo',
  3: 'Moderado',
  4: 'Bom',
  5: 'Excelente',
};

function ScaleSelector({
  label,
  value,
  onChange,
  color,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  color: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-[#E0E0E0]">{label}</span>
        <span className="text-xs text-[#888]">{scaleLabels[value]}</span>
      </div>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className="flex-1 h-10 rounded-lg text-sm font-medium transition-all"
            style={{
              background: n <= value ? color : '#1A1A1A',
              color: n <= value ? (color === '#1E293B' ? '#E0E0E0' : '#0E0E0E') : '#666',
              border: `1px solid ${n <= value ? color : '#333'}`,
            }}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

const DosePerceptionModal = ({ doseType, onConfirm, onClose }: DosePerceptionModalProps) => {
  const config = doseConfig[doseType];
  const [feeling, setFeeling] = useState(3);
  const [energy, setEnergy] = useState(3);
  const [clarity, setClarity] = useState(3);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleConfirm = async () => {
    setSaving(true);
    try {
      await onConfirm({
        perceived_feeling: feeling,
        perceived_energy: energy,
        perceived_clarity: clarity,
        notes: notes.trim(),
      });
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md p-6 space-y-5"
        style={{
          background: '#0E0E0E',
          border: '1px solid #222',
          borderRadius: '16px 16px 0 0',
          animation: 'slide-up 300ms ease-out',
          fontFamily: 'Inter, sans-serif',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[#666] hover:text-[#E0E0E0] transition-colors"
        >
          <X size={20} />
        </button>

        {/* Header */}
        <div className="text-center pt-1">
          <h3 className="text-base font-semibold text-[#E0E0E0]">
            {config.label} · Registrar dose
          </h3>
          <p className="text-xs text-[#888] mt-1">
            Como você está se sentindo agora?
          </p>
        </div>

        {/* Scales */}
        <div className="space-y-4">
          <ScaleSelector
            label="Como você está se sentindo?"
            value={feeling}
            onChange={setFeeling}
            color={config.color}
          />
          <ScaleSelector
            label="Energia percebida"
            value={energy}
            onChange={setEnergy}
            color={config.color}
          />
          <ScaleSelector
            label="Clareza mental"
            value={clarity}
            onChange={setClarity}
            color={config.color}
          />
        </div>

        {/* Notes */}
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-[#E0E0E0]">Observações</span>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Opcional — descreva algo que queira registrar..."
            className="min-h-[72px] text-sm rounded-lg"
            style={{
              background: '#1A1A1A',
              border: '1px solid #333',
              color: '#E0E0E0',
            }}
          />
        </div>

        {/* Confirm */}
        <button
          onClick={handleConfirm}
          disabled={saving}
          className="w-full py-3.5 rounded-xl text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-50"
          style={{
            background: config.color,
            color: config.color === '#1E293B' ? '#E0E0E0' : '#0E0E0E',
            boxShadow: `0 4px 16px -4px ${config.color}66`,
          }}
        >
          {saving ? 'Registrando...' : 'Registrar'}
        </button>
      </div>
    </div>
  );
};

export default DosePerceptionModal;
