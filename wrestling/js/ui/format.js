// Small display helpers. Nothing here reads or writes game state.

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function mmss(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function signedTime(sec) {
  return (sec < 0 ? '-' : '+') + mmss(Math.abs(sec));
}

export function signed(n) {
  return n > 0 ? `+${n}` : String(n);
}

/** Colour class for a signed value: brass for good, oxblood for bad. */
export function toneOf(n, invert = false) {
  if (n === 0) return 'muted';
  const good = invert ? n < 0 : n > 0;
  return good ? 'pos' : 'neg';
}

/** A 0-100 bar. Low values read as a problem, so they turn oxblood. */
export function meter(value, lowBelow = 35) {
  const v = Math.max(0, Math.min(100, value));
  return `<div class="meter"><i class="${v < lowBelow ? 'low' : ''}" style="width:${v}%"></i></div>`;
}

export function titleCase(s) {
  return String(s)
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')   // workRate -> work Rate
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function money(n) {
  return n ? `$${Math.round(n).toLocaleString('en-US')}` : '-';
}
