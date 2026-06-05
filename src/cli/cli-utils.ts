export function parseBudget(v: string): 'low' | 'normal' | 'deep' {
  return (['low', 'normal', 'deep'].includes(v) ? v : 'low') as 'low' | 'normal' | 'deep';
}

export function parsePositiveInt(value: string | undefined, fallback: number, max: number): number {
  if (!value) return fallback;
  return Math.max(1, Math.min(max, parseInt(String(value), 10) || fallback));
}
