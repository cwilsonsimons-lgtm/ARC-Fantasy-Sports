// Universe — standings, rankings and booking balance.
//
// Read-only arithmetic over the results the owner has entered. Nothing in
// the model consults any of it: booking a match, putting a title on the line
// and entering who won never look at a ranking, so a wrestler at the bottom
// of every table can still be booked for any title and win it.
//
// Three things are worked out here, each explained in the app in the same
// terms as these comments:
//
//   Standings  - singles and tag records kept apart, for a season or all
//                time, ranked by a smoothed winning percentage.
//   Balance    - who, on one show and over a chosen stretch of weeks, has had
//                far fewer matches than is typical for their division there.
//                Nobody is expected to wrestle as often as everyone else, and
//                show sizes never come into it.
//   Ideas      - plausible opponents for someone short of matches. Only
//                suggestions: nothing is booked until the owner books it, and
//                the result is always whatever the game produces.
import {
  activeSeason, blankRecord, byName, compareStamps, movesOf, resultFor, seasonById, teamById, titleById,
  weeksBetween, wrestlerById,
} from './model.js';

// ---------------------------------------------------------------- periods

const sn = (st, id) => (seasonById(st, id) || { number: 0 }).number;
// is a stamp or date in week `b` or earlier?
const upTo = (st, a, b) => sn(st, a.season) < sn(st, b.season) || (sn(st, a.season) === sn(st, b.season) && a.week <= b.week);

// the last week of a season that has anything in it: the clock, or a later
// result entered ahead of it
function lastWeek(st, s) {
  const played = st.events.filter(e => e.at.season === s.id && e.matches.some(m => m.status === 'played')).map(e => e.at.week);
  return Math.max(s.status === 'active' ? s.week : s.ended.week, ...played, 1);
}

/**
 * A stretch of the calendar to count over: 'all', a season id, or 'last4' /
 * 'last8' (the most recent weeks of the current season). Returns
 * { kind, seasonId, from, to, end, label } - weeks from..to of one season
 * (seasonId null for all time), and `end`, the week whose rosters count:
 * a finished season's last week, otherwise now (null).
 */
export function periodOf(st, spec) {
  const cur = activeSeason(st);
  if (spec === 'all') return { kind: 'all', seasonId: null, from: null, to: null, end: null, label: 'All time' };
  const recent = /^last(\d+)$/.exec(spec || '');
  if (recent) {
    const to = lastWeek(st, cur), n = Number(recent[1]);
    return { kind: 'recent', seasonId: cur.id, from: Math.max(1, to - n + 1), to, end: null, label: `Last ${n} weeks` };
  }
  const s = seasonById(st, spec) || cur;
  const done = s.status !== 'active';
  return { kind: 'season', seasonId: s.id, from: 1, to: lastWeek(st, s), end: done ? { season: s.id, week: s.ended.week } : null,
    label: s.name };
}
const inPeriod = (p, ev) => p.kind === 'all' || (ev.at.season === p.seasonId && ev.at.week >= p.from && ev.at.week <= p.to);
const weeksOf = p => Array.from({ length: p.to - p.from + 1 }, (_, i) => p.from + i);

/** The show a wrestler was on at the end of a week (`date` null: now). */
export function showAt(st, w, date) {
  if (!date) return w.showId;
  const moves = movesOf(st, w.id);
  let show = moves.length ? moves[0].from : w.showId;
  for (const m of moves) {
    if (!upTo(st, m.at, date)) break;
    show = m.to;
  }
  return show;
}

// a team at the end of a week: whether it was together, and who was on it
function teamAt(st, t, date) {
  if (!date) return { active: t.active, members: t.members };
  let active = false;
  t.log.forEach(e => { if (upTo(st, e.at, date)) active = e.type !== 'disbanded'; });
  const members = st.memberships.filter(m => m.team === t.id && upTo(st, m.start, date) && !(m.end && upTo(st, m.end, date)))
    .map(m => m.wrestler);
  return { active, members };
}
const teamOnShow = (st, t, showId, date) => {
  const { members } = teamAt(st, t, date);
  return members.some(id => { const w = wrestlerById(st, id); return w && showAt(st, w, date) === showId; });
};

// ---------------------------------------------------------------- tallies

// One pass over the played matches in a period, oldest first: every
// wrestler's singles and tag results and every team's own, in order.
function tally(st, p) {
  const singles = new Map(), tag = new Map(), teams = new Map();
  const add = (map, id, r, ev) => {
    if (!map.has(id)) map.set(id, { rec: blankRecord(), results: [], last: null });
    const e = map.get(id);
    e.rec[{ W: 'w', L: 'l', D: 'd', NC: 'nc' }[r]]++;
    e.results.push(r);
    e.last = ev;
  };
  st.events.filter(ev => inPeriod(p, ev)).sort((a, b) => compareStamps(st, a.at, b.at)).forEach(ev => ev.matches.forEach(m => {
    if (m.status !== 'played') return;
    m.sides.forEach((sd, i) => {
      const r = resultFor(m, i);
      sd.wrestlers.forEach(id => add(sd.wrestlers.length === 1 ? singles : tag, id, r, ev));
      if (sd.team) add(teams, sd.team, r, ev);
    });
  }));
  return { singles, tag, teams };
}

/**
 * The ranking score: winning percentage with one win and one loss added to
 * everyone, a draw counting half. No contests don't count. The added win and
 * loss keep a small sample honest - 1-0 is 67%, 5-0 is 86%, 10-2 is 79%.
 */
export function rating(rec) {
  return (rec.w + rec.d / 2 + 1) / (rec.w + rec.l + rec.d + 2);
}

function streakOf(results) {
  const counted = results.filter(r => r !== 'NC');
  if (!counted.length) return null;
  const last = counted[counted.length - 1];
  let n = 0;
  for (let i = counted.length - 1; i >= 0 && counted[i] === last; i--) n++;
  return { type: last, n };
}

// titles a holder held at the end of a week (now, when date is null)
function heldAt(st, holder, date) {
  return st.reigns.filter(r => r.holder.type === holder.type && r.holder.id === holder.id
    && (date ? upTo(st, r.start, date) && !(r.end && upTo(st, r.end, date)) : !r.end))
    .map(r => titleById(st, r.titleId)).filter(Boolean);
}

/**
 * Rank rows by score, then more wins, then fewer losses, then name. Rows
 * with nothing to rank on (no wins, losses or draws) aren't ranked.
 * Tied rows share a rank. Returns { ranked, unranked }.
 */
export function rankRows(rows) {
  const played = r => r.rec.w + r.rec.l + r.rec.d;
  const ranked = rows.filter(r => played(r) > 0)
    .sort((a, b) => b.score - a.score || b.rec.w - a.rec.w || a.rec.l - b.rec.l || byName(a, b));
  ranked.forEach((r, i) => {
    const p = ranked[i - 1];
    r.rank = p && p.score === r.score && p.rec.w === r.rec.w && p.rec.l === r.rec.l ? p.rank : i + 1;
  });
  return { ranked, unranked: rows.filter(r => played(r) === 0).sort(byName) };
}

const row = (st, kind, x, entry, date) => {
  const rec = entry ? entry.rec : blankRecord();
  const results = entry ? entry.results : [];
  return {
    kind, id: x.id, name: x.name, gender: x.gender || null, status: x.status || null, active: x.active,
    rec, score: rating(rec), form: results.slice(-5).reverse(), streak: streakOf(results),
    last: entry ? entry.last : null, titles: heldAt(st, { type: kind === 'team' ? 'team' : 'wrestler', id: x.id }, date),
  };
};

/**
 * A show's standings for a period. `showId` null means every show. Who's on
 * a show: where they were at the end of a finished season, otherwise where
 * they are now. Their record is every result in the period, wherever it
 * happened.
 *   singles - every wrestler, on singles results
 *   tag     - every wrestler, on tag results (with any partner)
 *   teams   - registered teams on their own results; a team is on a show when
 *             a member is (a split team is on both), listed while together or
 *             if it wrestled in the period
 * Each: { ranked, unranked } of rows { id, name, rec, score, rank, form, streak, titles, ... }.
 */
export function standings(st, { showId = null, period, kind = 'singles' }) {
  const t = tally(st, period);
  const date = period.end;
  if (kind === 'teams') {
    const rows = st.teams.filter(team => {
      const on = showId ? teamOnShow(st, team, showId, date) : true;
      return on && (teamAt(st, team, date).active || t.teams.has(team.id));
    }).map(team => row(st, 'team', team, t.teams.get(team.id), date));
    return rankRows(rows);
  }
  const map = kind === 'tag' ? t.tag : t.singles;
  const rows = st.wrestlers.filter(w => (showId ? showAt(st, w, date) === showId : true))
    .map(w => row(st, 'wrestler', w, map.get(w.id), date));
  return rankRows(rows);
}

// ---------------------------------------------------------------- booking balance

export const MIN_WEEKS = 2;      // weeks on the show before anyone is judged
export const MIN_GROUP = 3;      // judged peers needed to say what's typical
export const MIN_SHORT = 2;      // matches short of typical before a flag

// matches booked for this week or later, with no result yet, soonest first
function pendingFor(st, kind, id) {
  const now = nowDate(st);
  const out = [];
  st.events.forEach(event => event.matches.forEach(match => {
    if (match.status !== 'scheduled' || event.at.season !== now.season || event.at.week < now.week) return;
    if (match.sides.some(sd => (kind === 'team' ? sd.team === id : sd.wrestlers.includes(id)))) out.push({ event, match });
  }));
  return out.sort((a, b) => compareStamps(st, a.event.at, b.event.at));
}

const median = xs => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Rates for one group of peers, and who is well short. Mutates the rows.
function judge(rows) {
  const judged = rows.filter(r => !r.injured && r.weeks >= MIN_WEEKS);
  const enough = judged.length >= MIN_GROUP;
  const typical = enough ? median(judged.map(r => r.rate)) : null;
  rows.forEach(r => {
    r.judged = enough && judged.includes(r);
    r.expected = r.judged ? typical * r.weeks : null;
    r.short = r.judged ? r.expected - r.matches : 0;
    r.flagged = r.judged && typical > 0 && r.rate <= typical / 2 && r.short >= MIN_SHORT;
    r.severity = r.flagged ? (r.rate <= typical / 4 ? 'well below' : 'below') : null;
  });
  return { rows, judged: judged.length, typical, enough };
}

/**
 * Who on a show has had far fewer matches than is typical for their peers
 * there, over a period of one season (not all time). Peers are the show's
 * current wrestlers in the same division, or its current tag teams.
 *
 *   weeks     weeks of the period they were on the show
 *   matches   results they had in those weeks, singles and tag, on any show
 *             (a team: only matches as the team)
 *   rate      matches / weeks
 *   typical   the median rate of the group, counting only those on the show
 *             for at least MIN_WEEKS and not injured; needs MIN_GROUP of them
 *   flagged   rate at most half of typical AND at least MIN_SHORT matches
 *             fewer than typical x their weeks - so a quiet show flags nobody
 *
 * Returns { period, groups: [{ key, label, rows, judged, typical, enough }] }.
 */
export function balance(st, { showId, period }) {
  const weeks = weeksOf(period);
  const date = w => ({ season: period.seasonId, week: w });
  const events = st.events.filter(ev => inPeriod(period, ev));
  const played = events.flatMap(ev => ev.matches.filter(m => m.status === 'played').map(m => ({ ev, m })));

  const wrestlerRow = w => {
    const on = new Set(weeks.filter(wk => showAt(st, w, date(wk)) === showId));
    const mine = played.filter(({ ev, m }) => on.has(ev.at.week) && m.sides.some(sd => sd.wrestlers.includes(w.id)));
    const singles = mine.filter(({ m }) => m.sides.find(sd => sd.wrestlers.includes(w.id)).wrestlers.length === 1).length;
    return { kind: 'wrestler', id: w.id, name: w.name, gender: w.gender, injured: w.status === 'injured', weeks: on.size,
      matches: mine.length, singles, tag: mine.length - singles, rate: on.size ? mine.length / on.size : 0,
      last: lastOf(st, mine), booked: pendingFor(st, 'wrestler', w.id) };
  };
  const teamRow = t => {
    const on = new Set(weeks.filter(wk => teamAt(st, t, date(wk)).active && teamOnShow(st, t, showId, date(wk))));
    const mine = played.filter(({ ev, m }) => on.has(ev.at.week) && m.sides.some(sd => sd.team === t.id));
    return { kind: 'team', id: t.id, name: t.name, injured: t.members.some(id => (wrestlerById(st, id) || {}).status === 'injured'),
      weeks: on.size, matches: mine.length, rate: on.size ? mine.length / on.size : 0, last: lastOf(st, mine),
      booked: pendingFor(st, 'team', t.id) };
  };

  const roster = st.wrestlers.filter(w => w.showId === showId);
  const groups = [['male', 'Men’s division'], ['female', 'Women’s division']].map(([g, label]) => {
    const rows = roster.filter(w => w.gender === g).map(wrestlerRow).sort(byRate);
    return { key: g, label, ...judge(rows) };
  }).filter(g => g.rows.length);
  const teams = st.teams.filter(t => t.active && t.members.some(id => (wrestlerById(st, id) || {}).showId === showId))
    .map(teamRow).sort(byRate);
  if (teams.length) groups.push({ key: 'teams', label: 'Tag teams', ...judge(teams) });
  return { period, groups };
}
const byRate = (a, b) => a.rate - b.rate || a.matches - b.matches || byName(a, b);
function lastOf(st, list) {
  return list.reduce((best, x) => (!best || compareStamps(st, x.ev.at, best.at) > 0 ? x.ev : best), null);
}

// ---------------------------------------------------------------- match ideas

// Every meeting between two sides-to-be: { n, a, b, other, last } - wins for
// each, and anything else (a draw, a no contest, someone else winning).
function headToHead(st, onSide, x, y) {
  const out = { n: 0, a: 0, b: 0, other: 0, last: null };
  st.events.forEach(ev => ev.matches.forEach(m => {
    if (m.status !== 'played') return;
    const i = m.sides.findIndex(sd => onSide(sd, x)), j = m.sides.findIndex(sd => onSide(sd, y));
    if (i < 0 || j < 0 || i === j) return;
    out.n++;
    if (m.outcome === 'win' && m.winner === i) out.a++;
    else if (m.outcome === 'win' && m.winner === j) out.b++;
    else out.other++;
    if (!out.last || compareStamps(st, ev.at, out.last.at) > 0) out.last = ev;
  }));
  return out;
}

const nowDate = st => ({ season: activeSeason(st).id, week: activeSeason(st).week });

/**
 * Up to three plausible opponents for someone short of matches: [{ lineup,
 * opponent, score, reasons, note }]. `lineup` is the two sides, ready for the
 * booking form - never a result. Opponents are on the same show now, not
 * injured, in the same division (a team: another team there with nobody in
 * common), and never the subject's own tag partners.
 *
 * Each is scored on: both being short of matches (+3), a rivalry (+2, met two
 * or more times) or a recent first meeting (+1.5, within six weeks), being
 * close in this season's standings (up to +1.5), a chance to beat someone
 * near the top (+0.75), never having met (+0.75), and holding a title (+0.5);
 * less if the opponent already has a match booked (-1) or they met last week
 * (-1). Ties go by name.
 */
export function matchIdeas(st, subject, { showId, balanceResult }) {
  const flagged = new Set(balanceResult.groups.flatMap(g => g.rows.filter(r => r.flagged).map(r => `${r.kind}:${r.id}`)));
  const season = periodOf(st, activeSeason(st).id);
  const team = subject.kind === 'team';
  const self = team ? teamById(st, subject.id) : wrestlerById(st, subject.id);
  if (!self) return [];

  let pool, onSide, ranks;
  if (team) {
    pool = st.teams.filter(t => t.id !== self.id && t.active && !t.members.some(id => self.members.includes(id))
      && t.members.some(id => (wrestlerById(st, id) || {}).showId === showId)
      && !t.members.some(id => (wrestlerById(st, id) || {}).status === 'injured'));
    onSide = (sd, id) => sd.team === id;
    ranks = standings(st, { showId, period: season, kind: 'teams' });
  } else {
    const partners = new Set(st.teams.filter(t => t.active && t.members.includes(self.id)).flatMap(t => t.members));
    pool = st.wrestlers.filter(w => w.id !== self.id && w.showId === showId && w.status !== 'injured'
      && w.gender === self.gender && !partners.has(w.id));
    onSide = (sd, id) => sd.wrestlers.includes(id);
    ranks = standings(st, { showId, period: season, kind: 'singles' });
  }
  // ranked the way the standings table shows them: a wrestler within their division
  const div = rankRows([...ranks.ranked, ...ranks.unranked].filter(r => team || r.gender === self.gender));
  const standing = new Map(div.ranked.map(r => [r.id, { score: r.score, rank: r.rank }]));
  const me = standing.get(self.id);
  const now = nowDate(st);

  const ideas = pool.map(o => {
    const reasons = [];
    let score = 0, note = '';
    if (flagged.has(`${subject.kind}:${o.id}`)) { score += 3; reasons.push('Both are short of matches'); }
    const h = headToHead(st, onSide, self.id, o.id);
    const ago = h.last ? weeksBetween(st, h.last.at, now) : null;
    if (h.n >= 2) {
      score += 2;
      reasons.push(`Rivalry: met ${h.n} times — ${self.name} ${h.a}, ${o.name} ${h.b}${h.other ? `, ${h.other} other` : ''}`);
    } else if (h.n === 1 && ago <= 6) {
      score += 1.5;
      reasons.push(h.a ? `Rematch: ${self.name} won in week ${h.last.at.week}` : h.b ? `Rematch: ${o.name} won in week ${h.last.at.week}`
        : `Unfinished: no winner in week ${h.last.at.week}`);
    } else if (!h.n) {
      score += 0.75;
      reasons.push('Fresh matchup: they’ve never met');
    }
    const them = standing.get(o.id);
    if (me && them) {
      const close = 1 - Math.min(1, Math.abs(me.score - them.score) / 0.3);
      score += 1.5 * close;
      if (close >= 0.5) reasons.push(`Close in the standings: #${me.rank} and #${them.rank}`);
      if (them.rank <= 3 && me.rank > them.rank + 2) { score += 0.75; reasons.push(`A shot at #${them.rank} ${o.name}`); }
    } else if (them && them.rank <= 3) {
      score += 0.75;
      reasons.push(`A shot at #${them.rank} ${o.name}`);
    }
    const held = heldAt(st, { type: team ? 'team' : 'wrestler', id: o.id }, null);
    if (held.length) { score += 0.5; reasons.push(`${o.name} ${team ? 'hold' : 'holds'} the ${held[0].name}`); }
    const upcoming = pendingFor(st, subject.kind, o.id);
    if (upcoming.length) { score -= 1; note = `${o.name} ${team ? 'are' : 'is'} already booked: ${upcoming[0].event.name}`; }
    if (h.last && ago <= 1) { score -= 1; note = note || (ago === 0 ? 'They already met this week' : 'They met last week'); }
    const side = x => (team ? { team: x.id, wrestlers: [...x.members] } : { team: '', wrestlers: [x.id] });
    return { opponent: { kind: subject.kind, id: o.id, name: o.name }, lineup: [side(self), side(o)], score, reasons, note };
  });
  return ideas.sort((a, b) => b.score - a.score || byName(a.opponent, b.opponent)).slice(0, 3);
}
