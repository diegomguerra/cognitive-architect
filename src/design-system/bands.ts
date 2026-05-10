// VYR Design System v1 — band utilities
// Score 0-100 → faixa de excelência:
//   85+        Optimal       (branco)
//   70-84      Good          (slate)
//   60-69      Fair          (amber)
//   <60        Pay attention (red)

export type Band = 'opt' | 'good' | 'fair' | 'low';

export const BAND_LABELS: Record<Band, string> = {
  opt: 'Optimal',
  good: 'Good',
  fair: 'Fair',
  low: 'Pay attention',
};

export const BAND_COLORS: Record<Band, string> = {
  opt: '#FAFAFA',
  good: '#94A3B8',
  fair: '#D97706',
  low: '#DC2626',
};

export const BAND_RANGES: Record<Band, { min: number; max: number }> = {
  opt: { min: 85, max: 100 },
  good: { min: 70, max: 84 },
  fair: { min: 60, max: 69 },
  low: { min: 0, max: 59 },
};

export function getBand(score: number): Band {
  if (score >= 85) return 'opt';
  if (score >= 70) return 'good';
  if (score >= 60) return 'fair';
  return 'low';
}

export function getBandLabel(score: number): string {
  return BAND_LABELS[getBand(score)];
}

export function getBandColor(score: number): string {
  return BAND_COLORS[getBand(score)];
}

// Tailwind class helpers (Insights theme)
export function bandTextClass(score: number): string {
  const band = getBand(score);
  if (band === 'opt') return 'text-ds-opt';
  if (band === 'good') return 'text-ds-good';
  if (band === 'fair') return 'text-ds-fair';
  return 'text-ds-low';
}

export function bandBgClass(score: number): string {
  const band = getBand(score);
  if (band === 'opt') return 'bg-ds-opt';
  if (band === 'good') return 'bg-ds-good';
  if (band === 'fair') return 'bg-ds-fair';
  return 'bg-ds-low';
}
