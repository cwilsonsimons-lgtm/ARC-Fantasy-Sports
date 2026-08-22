// Records, averages, and the caption suggestions built from them.
//
// Everything here reads the scores entered on the Scores tab — nothing is
// simulated. A week with a blank score simply does not count, so the numbers on
// a graphic are always "through the games you have actually entered".
import { HISTORY_LINES, ord } from './data.js';

// Records include the league median: the top half of the week's scoring picks up
// an extra win, the bottom half an extra loss. That is how this league runs, and
// it is the number people argue about, so the graphic has to show it.
export function statsThroughWeek(lg, beforeWeek) {
  const stats = {};
  for (const t of lg.teams) stats[t.id] = { w: 0, l: 0, t: 0, pts: 0, games: 0 };
  lg.weeks.forEach((week, wi) => {
    if (wi >= beforeWeek) return;
    const weekScores = [];
    for (const m of week) {
      if (!m.a || !m.b) continue;
      const sa = parseFloat(m.sa), sb = parseFloat(m.sb);
      if (isNaN(sa) || isNaN(sb)) continue;
      if (!stats[m.a] || !stats[m.b]) continue;
      stats[m.a].pts += sa; stats[m.a].games++;
      stats[m.b].pts += sb; stats[m.b].games++;
      weekScores.push({ id: m.a, p: sa }, { id: m.b, p: sb });
      if (sa > sb) { stats[m.a].w++; stats[m.b].l++; }
      else if (sb > sa) { stats[m.b].w++; stats[m.a].l++; }
      else { stats[m.a].t++; stats[m.b].t++; }
    }
    if (weekScores.length >= 2) {
      weekScores.sort((x, y) => y.p - x.p);
      const winners = Math.floor(weekScores.length / 2);
      weekScores.forEach((s, i) => { if (i < winners) stats[s.id].w++; else stats[s.id].l++; });
    }
  });
  return stats;
}

export const fmtRecord = (s) => (s.t > 0 ? `${s.w}-${s.l}-${s.t}` : `${s.w}-${s.l}`);
export const fmtPpg = (s) => (s.games ? (s.pts / s.games).toFixed(2) : '—');

// every completed game a team has played before `beforeWeek`
export function gameLog(lg, tid, beforeWeek) {
  const log = [];
  lg.weeks.forEach((wk, wi) => {
    if (wi >= beforeWeek) return;
    wk.forEach((m) => {
      const sa = parseFloat(m.sa), sb = parseFloat(m.sb);
      if (isNaN(sa) || isNaN(sb)) return;
      if (m.a === tid) log.push({ wi, pts: sa, opp: sb });
      else if (m.b === tid) log.push({ wi, pts: sb, opp: sa });
    });
  });
  return log;
}

function weekScoreboard(lg, wi) {
  const out = [];
  (lg.weeks[wi] || []).forEach((m) => {
    const sa = parseFloat(m.sa), sb = parseFloat(m.sb);
    if (!isNaN(sa) && m.a) out.push({ t: m.a, p: sa });
    if (!isNaN(sb) && m.b) out.push({ t: m.b, p: sb });
  });
  out.sort((x, y) => y.p - x.p);
  return out;
}

// Suggestions, best-first: things that happened this season, then last season's
// receipts. Only lines the entered scores actually support are offered — no
// invented stats.
export function roastsFor(lg, tid, beforeWeek) {
  if (!tid) return [];
  const out = [];
  const log = gameLog(lg, tid, beforeWeek);
  if (log.length) {
    const last = log[log.length - 1];
    const lastWin = last.pts > last.opp;
    let streak = 0;
    for (let i = log.length - 1; i >= 0; i--) {
      if ((log[i].pts > log[i].opp) === lastWin) streak++; else break;
    }
    if (streak >= 2) out.push(`(Has ${lastWin ? 'won' : 'lost'} ${streak} straight)`);

    // where they finished in last week's scoring
    const board = weekScoreboard(lg, last.wi);
    const r = board.findIndex((x) => x.t === tid) + 1;
    const n = board.length;
    if (r === 1) out.push('(Highest scoring team in the league last week)');
    else if (r === n) out.push('(Lowest scoring team in the league last week)');
    else if (r <= 3) out.push(`(${ord(r)} highest scoring team last week)`);
    else if (r >= n - 1) out.push(`(${ord(n - r + 1)} lowest scoring team last week)`);

    // season scoring rank
    const stats = statsThroughWeek(lg, beforeWeek);
    const ranked = lg.teams
      .map((t) => ({ id: t.id, ppg: stats[t.id].games ? stats[t.id].pts / stats[t.id].games : -1 }))
      .filter((x) => x.ppg >= 0)
      .sort((a, b) => b.ppg - a.ppg);
    const pr = ranked.findIndex((x) => x.id === tid) + 1;
    if (pr === 1 && ranked.length > 3) out.push('(Highest PPG in the league)');
    else if (pr === ranked.length && ranked.length > 3) out.push('(Lowest PPG in the league)');

    // record against the median — the "unlucky" argument, settled
    let mw = 0, ml = 0;
    log.forEach((g) => {
      const ws = weekScoreboard(lg, g.wi);
      const idx = ws.findIndex((x) => x.t === tid);
      if (idx >= 0) { if (idx < Math.floor(ws.length / 2)) mw++; else ml++; }
    });
    if (mw + ml >= 3 && ml > mw * 2) out.push(`(${mw}-${ml} against the league median)`);
    else if (mw + ml >= 3 && mw > ml * 2 && ml > 0)
      out.push(`(${mw}-${ml} vs the median but can’t beat an actual opponent)`);

    // one-score games
    let cw = 0, cl = 0;
    log.forEach((g) => { if (Math.abs(g.pts - g.opp) < 10) { if (g.pts > g.opp) cw++; else cl++; } });
    if (cw + cl >= 2 && cl > cw) out.push(`(${cw}-${cl} in games decided by less than 10)`);
    else if (cw >= 2 && cl === 0) out.push(`(${cw}-0 in games decided by less than 10)`);
  }
  out.push(...(HISTORY_LINES[tid] || []));
  return out.slice(0, 6);
}
