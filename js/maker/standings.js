// Records, points and standings, derived from the scores you enter.
//
// Nothing here is stored. Every number on a screen is recomputed from the
// results table, so fixing a score that was typed wrong in week 3 corrects the
// records on every screen made after it rather than leaving a stale copy behind.

import { state } from './store.js';

const num = v => (typeof v === 'number' && isFinite(v));
export const isFinal = g => !!g && g.final && num(g.as) && num(g.bs);

// `through` is inclusive. A preview screen for week 12 wants stats through
// week 11 - the records as the teams walk in - while a recap wants week 12.
export function stats(through = 99) {
  const rows = new Map();
  const row = id => {
    if (!rows.has(id)) rows.set(id, { id, w: 0, l: 0, t: 0, pf: 0, pa: 0, gp: 0, res: [] });
    return rows.get(id);
  };
  state.teams.forEach(t => row(t.id));

  Object.keys(state.schedule).map(Number).sort((a, b) => a - b).forEach(wk => {
    if (wk > through) return;
    state.schedule[wk].forEach(g => {
      if (!isFinal(g) || !g.a || !g.b) return;
      const A = row(g.a), B = row(g.b);
      A.pf += g.as; A.pa += g.bs; A.gp++;
      B.pf += g.bs; B.pa += g.as; B.gp++;
      if (g.as > g.bs)      { A.w++; B.l++; A.res.push('W'); B.res.push('L'); }
      else if (g.bs > g.as) { B.w++; A.l++; B.res.push('W'); A.res.push('L'); }
      else                  { A.t++; B.t++; A.res.push('T'); B.res.push('T'); }
    });
  });

  const anyTie = [...rows.values()].some(r => r.t);
  rows.forEach(r => {
    r.ppg = r.gp ? r.pf / r.gp : 0;
    r.papg = r.gp ? r.pa / r.gp : 0;
    r.pct = r.gp ? (r.w + r.t / 2) / r.gp : 0;
    r.record = anyTie ? `${r.w}-${r.l}-${r.t}` : `${r.w}-${r.l}`;
    r.streak = streakOf(r.res);
  });

  // Standard fantasy tiebreak: win percentage, then points for.
  const order = [...rows.values()].sort((a, b) => b.pct - a.pct || b.pf - a.pf);
  order.forEach((r, i) => { r.rank = i + 1; });
  return { rows, order };
}

function streakOf(res) {
  if (!res.length) return '-';
  const last = res[res.length - 1];
  let n = 0;
  for (let i = res.length - 1; i >= 0 && res[i] === last; i--) n++;
  return last + n;
}

// Weeks that have any matchup at all, in order - what the week picker lists.
export function weekNumbers() {
  const ns = Object.keys(state.schedule).map(Number).filter(n => n > 0);
  for (let i = 1; i <= (state.weeks || 14); i++) if (!ns.includes(i)) ns.push(i);
  return ns.sort((a, b) => a - b);
}

// Circle method: every team plays every other once across N-1 weeks. Odd team
// counts get a bye, which shows up as a game with an empty side.
export function roundRobin(ids, weeks) {
  const list = ids.slice();
  if (list.length % 2) list.push('');
  const n = list.length, half = n / 2, out = {};
  let ring = list.slice(1);
  for (let w = 1; w <= weeks; w++) {
    const round = [list[0]].concat(ring);
    const pairs = [];
    for (let i = 0; i < half; i++) {
      const a = round[i], b = round[n - 1 - i];
      // Alternate home/away by week so the same side is not always on the left.
      pairs.push(w % 2 ? [a, b] : [b, a]);
    }
    out[w] = pairs.filter(p => p[0] && p[1]);
    ring = [ring[ring.length - 1]].concat(ring.slice(0, -1));
  }
  return out;
}
