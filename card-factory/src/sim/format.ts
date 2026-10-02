export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

export function fmtMoney(n: number, opts: { cents?: boolean; sign?: boolean } = {}) {
  const cents = opts.cents ?? Math.abs(n) < 100;
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  const sign = n < 0 ? '−' : opts.sign && n > 0 ? '+' : '';
  return `${sign}$${s}`;
}

export function fmtCompact(n: number) {
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return fmtMoney(n);
}

export function fmtPct(n: number, digits = 0) {
  return `${(n * 100).toFixed(digits)}%`;
}

export function fmtOdds(x: number | null) {
  if (x === null || !isFinite(x)) return '—';
  if (x < 1) return `${(1 / x).toFixed(x < 0.1 ? 0 : 1)} per`;
  return `1:${x < 10 ? x.toFixed(1) : fmtInt(x)}`;
}
