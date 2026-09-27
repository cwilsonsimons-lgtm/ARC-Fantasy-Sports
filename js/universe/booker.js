// Universe — the auto booker: a draft card for any show.
//
// Given an episode on the calendar, it drafts a whole card from what's on
// record: the show's roster (anyone injured, away or out tonight left aside),
// the championships it can put on the line, the standings, who has wrestled
// lately and who is short of matches, rivalries, grudges, friendships and
// alliances, tag teams and factions (a team of three or more), what each
// wrestler is after, arrivals from another tier, and the calendar - a premium
// live event coming up, or tonight being one. Each show's settings say how
// many matches and which kinds.
//
// It looks for matches that make sense: a champion and the best contender,
// rivals - or each other's allies and partners - a friend standing up to a
// friend's rival, teams and factions against each other, a rematch or a step
// up after an upset, a chance for someone short of matches, a first match for
// a new arrival. A feud builds across shows instead of repeating: after a
// one-on-one meeting it moves to partners and tag matches; with a premium live
// event ahead the singles match waits for it; a third meeting gets a
// stipulation to settle it.
//
// What it never does: pick a winner, simulate a match, or book anything. It
// returns ideas, each with its reasons; the draft (model.js) is the owner's to
// change, and only booking it puts it on the card. It doesn't read or make the
// story director's events either - only the relationships they leave behind.
//
// Pure: no DOM, no storage, no clock. Close calls are broken by a hash of the
// event, the draw number and the match, so the same save drafts the same card
// and drawing again draws a different one.
import * as M from './model.js';
import * as RL from './relations.js';
import * as SD from './standings.js';
import { draw, goalOf, history, momentumOf, weekNo } from './director.js';

export const TYPE_LABEL = { singles: 'Singles', tag: 'Tag team', triple: 'Triple threat', fourway: 'Fatal 4-way', trios: '6-person tag', handicap: 'Handicap' };
export const LEVEL_LABEL = { often: 'Often', sometimes: 'Sometimes', rarely: 'Rarely', never: 'Never' };
export const STIP_LABEL = { never: 'Never', feuds: 'Settling feuds', often: 'Often' };
export const KIND_LABEL = {
  title: 'Title match', vacant: 'Vacant title', contender: 'Contenders', feud: 'Feud', build: 'Feud builds', defend: 'Friend steps in',
  teams: 'Teams collide', rematch: 'Rematch', step: 'Step up', chance: 'Opportunity', turn: 'Turn it around', arrival: 'New arrival',
  fresh: 'Fresh matchup', 'multi': 'Multi-person',
};
const MIX_WEIGHT = { often: 1, sometimes: 0.5, rarely: 0.2, never: 0 };
export const RULES = {
  mixPull: 1.2,         // how hard the card leans toward each kind's share
  divisionPull: 1,      // ... and toward each division's share of who's available
  jitter: 0.8,          // how far a draw can move a score either way, for variety
  pleAhead: 4,          // weeks ahead a premium live event shapes a feud
  recentWeeks: 6,       // how far back "lately" looks
  sameFeud: 2,          // at most this many matches from one feud on a card
};
const FEUD_STIPS = ['No Disqualification', 'Street Fight', 'Last Man Standing', 'Falls Count Anywhere', 'Extreme Rules', 'Steel Cage'];
const PLE_STIPS = ['Hell in a Cell', 'Steel Cage', 'Last Man Standing', 'Street Fight', 'No Disqualification'];
const TAG_STIPS = ['Tables', 'Street Fight', 'No Disqualification'];

// ---------------------------------------------------------------- the shape of a match

/** What kind of match a line-up is, for the card's mix: singles, tag, triple, fourway, trios, handicap - or other. */
export function typeOf(m) {
  const k = M.matchKind(m).key;
  if (k === 'team-tag') return m.sides[0].wrestlers.length === 3 ? 'trios' : 'other';
  return { singles: 'singles', tag: 'tag', 'triple-threat': 'triple', 'fatal-4-way': 'fourway', handicap: 'handicap' }[k] || 'other';
}
const lineupKey = sides => sides.map(sd => [...sd.wrestlers].sort().join('+')).sort().join('|');
/** The key a drafted match goes by: who's in it and the title at stake. */
export const matchKey = m => `${m.titleId || '-'}:${lineupKey(m.sides)}`;
const inMatch = m => m.sides.flatMap(sd => sd.wrestlers);
const isSingles = m => m.sides.length === 2 && m.sides.every(sd => sd.wrestlers.length === 1);

// ---------------------------------------------------------------- what the booker knows about a show

function upcomingPle(st, ev, wk) {
  return st.events.filter(e => e.kind === 'ple' && e.id !== ev.id && (e.showId === ev.showId || e.showId === null)
      && M.compareStamps(st, e.at, ev.at) > 0 && weekNo(st, e.at) - wk <= RULES.pleAhead)
    .sort((a, b) => M.compareStamps(st, a.at, b.at)).map(e => ({ ev: e, weeks: weekNo(st, e.at) - wk }))[0] || null;
}

function context(st, ev, { nonce = 0, keep = [] } = {}) {
  const draft = ev.draft || { passed: [], out: [] };
  const showId = ev.showId || null;
  const settings = M.bookerSettings(st, showId);
  const ple = ev.kind === 'ple';
  const taken = new Set([...ev.matches.flatMap(inMatch), ...keep.flatMap(inMatch)]);
  const out = new Set(draft.out);
  const roster = st.wrestlers.filter(w => (showId ? w.showId === showId : !!w.showId));
  const avail = roster.filter(w => w.status === 'active' && !out.has(w.id));
  const free = new Set(avail.filter(w => !taken.has(w.id)).map(w => w.id));
  const wk = weekNo(st, ev.at);
  // where everyone stands this season, each division ranked on its own, as on the Rankings tab
  const period = SD.periodOf(st, ev.at.season);
  const table = SD.standings(st, { showId, period, kind: 'singles' });
  const rows = [...table.ranked, ...table.unranked];
  const rank = new Map();
  M.GENDERS.forEach(g => {
    const div = SD.rankRows(rows.filter(r => r.gender === g));
    div.ranked.forEach(r => rank.set(r.id, { rank: r.rank, score: r.score, of: div.ranked.length }));
  });
  const teamTable = SD.standings(st, { showId, period, kind: 'teams' });
  const teamRank = new Map(teamTable.ranked.map(r => [r.id, { rank: r.rank, score: r.score, of: teamTable.ranked.length }]));
  return {
    st, ev, showId, settings, ple, nonce, keep, taken, out, roster, avail, free, wk, rank, teamRank,
    size: ple ? settings.pleSize : settings.size,
    show: showId ? M.showById(st, showId) : null,
    d: RL.relationships(st),
    hist: history(st, ev.at),
    balance: showId ? SD.balance(st, { showId, period: SD.periodOf(st, 'last4') }) : { groups: [] },
    nextPle: ple ? null : upcomingPle(st, ev, wk),
    passed: new Set(draft.passed),
    goals: new Map(), moods: new Map(),
  };
}

const W = (c, id) => M.wrestlerById(c.st, id);
const nm = (c, id) => (W(c, id) || { name: '?' }).name;
const names = (c, ids) => ids.map(id => nm(c, id)).join(' & ');
const sideName = (c, sd) => (sd.team && M.teamById(c.st, sd.team) ? M.teamById(c.st, sd.team).name : names(c, sd.wrestlers));
const genderOf = (c, ids) => { const g = new Set(ids.map(id => (W(c, id) || {}).gender)); return g.size === 1 ? [...g][0] : 'mixed'; };
const division = g => (g === 'female' ? 'women’s' : 'men’s');
const fits = (w, t) => !!w && (t.division === 'open' || (t.division === 'men') === (w.gender === 'male'));
const lvl = (c, kind, a, b) => { const r = c.d.rels.get(RL.relKey(kind, a, b)); return r && r.active ? r.level || 1 : 0; };
const heatOf = (c, a, b) => Math.max(lvl(c, 'grudge', a, b), lvl(c, 'grudge', b, a), lvl(c, 'rivals', a, b));
const bondOf = (c, a, b) => Math.max(lvl(c, 'friends', a, b), lvl(c, 'allies', a, b));
const teamsOf = (c, id) => c.st.teams.filter(t => t.active && t.members.includes(id));
const partnered = (c, a, b) => teamsOf(c, a).some(t => t.members.includes(b));
const goal = (c, id) => { if (!c.goals.has(id)) c.goals.set(id, goalOf(c.st, id, c.d, c.hist)); return c.goals.get(id); };
const mood = (c, id) => { if (!c.moods.has(id)) c.moods.set(id, momentumOf(c.st, id, c.hist)); return c.moods.get(id); };
const rankLine = (c, id) => { const r = c.rank.get(id); return r ? `#${r.rank} in the ${division((W(c, id) || {}).gender)} standings` : ''; };
const ago = (c, wk) => (c.wk - wk <= 0 ? 'earlier this week' : c.wk - wk === 1 ? 'last week' : `${c.wk - wk} weeks ago`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const listOf = xs => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] || '');

// every played meeting between two wrestlers on opposite sides, oldest first
function meetings(c, a, b, weeks = 99) {
  return (c.hist.get(a) || []).filter(x => c.wk - x.wk < weeks && x.m.sides.some((sd, i) => i !== x.side && sd.wrestlers.includes(b)));
}
const lastMatch = (c, id) => { const h = c.hist.get(id) || []; return h.length ? h[h.length - 1].wk : null; };

// who would stand with someone: tag partners first, then friends and allies - free tonight, same division
function backers(c, id, not = []) {
  const g = (W(c, id) || {}).gender;
  return [...c.free].filter(x => x !== id && !not.includes(x) && (W(c, x) || {}).gender === g)
    .map(x => ({ id: x, partner: partnered(c, id, x), bond: bondOf(c, id, x) }))
    .filter(x => x.partner || x.bond)
    .sort((a, b) => (b.partner - a.partner) || b.bond - a.bond || nm(c, a.id).localeCompare(nm(c, b.id)))
    .map(x => ({ ...x, how: x.partner ? 'tag partner' : lvl(c, 'friends', id, x.id) ? 'friend' : 'ally' }));
}
// two people on one side: as their registered team when they're one
function pairSide(c, a, b) {
  const t = teamsOf(c, a).find(x => x.members.includes(b));
  return { team: t ? t.id : null, wrestlers: [a, b] };
}
const solo = id => ({ team: null, wrestlers: [id] });
// a team's free members, up to n
const freeOf = (c, t, n) => t.members.filter(id => c.free.has(id)).slice(0, n);

// an idea: a line-up, its stakes, its score and why
function idea(c, kind, sides, { titleId = null, stip = '', notes = '', score, weight = 3, why = [], feud = null }) {
  const m = { sides: sides.map(sd => ({ team: sd.team || null, wrestlers: [...sd.wrestlers] })), titleId };
  const people = inMatch(m);
  let s = score;
  // the same match every week is exactly what a card shouldn't be
  if (kind !== 'rematch' && isSingles(m)) {
    const met = meetings(c, people[0], people[1], 3).filter(x => isSingles(x.m));
    const last = met.length ? met[met.length - 1].wk : null;
    if (last != null && c.wk - last <= 1) s -= kind === 'title' ? 1.5 : 2.5;
    else if (last != null && c.wk - last <= 2) s -= 1;
  }
  return { key: matchKey(m), kind, type: typeOf(m), gender: genderOf(c, people), sides: m.sides, titleId, stip, notes,
    score: s, weight, why: why.filter(Boolean), feud, people };
}

// ---------------------------------------------------------------- championships

// the titles a show can put on the line: its own, and any with no show whose champion is here
function titlesFor(c) {
  const st = c.st;
  return st.titles.filter(t => {
    if (!t.active) return false;
    if (!c.showId || t.showId === c.showId) return true;
    if (t.showId) return false;
    const r = M.currentReign(st, t.id);
    const ids = r ? (r.holder.type === 'team' ? (M.teamById(st, r.holder.id) || { members: [] }).members : [r.holder.id]) : [];
    return ids.some(id => (W(c, id) || {}).showId === c.showId);
  });
}
// weeks since a title was last on the line in a result, or since the reign began
function titleIdle(c, t, reign) {
  const wks = c.st.events.filter(e => e.matches.some(m => m.status === 'played' && m.titleId === t.id) && M.compareStamps(c.st, e.at, c.ev.at) < 0)
    .map(e => weekNo(c.st, e.at));
  const since = wks.length ? Math.max(...wks) : reign ? weekNo(c.st, reign.start) : c.wk;
  return Math.max(0, c.wk - since);
}

// everyone who could challenge for a title tonight, scored and with their case
function contenders(c, t, champIds, champName) {
  const st = c.st;
  const pool = t.kind === 'tag'
    ? st.teams.filter(tm => tm.active && !tm.members.some(id => champIds.includes(id))).map(tm => {
      const ids = freeOf(c, tm, 2);
      return ids.length === 2 && ids.every(id => fits(W(c, id), t)) ? { ids, team: tm.id, name: tm.name, side: { team: tm.id, wrestlers: ids } } : null;
    }).filter(Boolean)
    : [...c.free].filter(id => !champIds.includes(id) && fits(W(c, id), t)).map(id => ({ ids: [id], team: null, name: nm(c, id), side: solo(id) }));
  return pool.map(k => {
    const reasons = [];
    let s = 0;
    const rk = k.team ? c.teamRank.get(k.team) : c.rank.get(k.ids[0]);
    if (rk && rk.rank === 1) { s += 2; reasons.push(k.team ? '#1 in the tag team standings' : rankLine(c, k.ids[0])); }
    else if (rk && rk.rank <= 3) { s += 1; reasons.push(k.team ? `#${rk.rank} in the tag team standings` : rankLine(c, k.ids[0])); }
    const wins = k.ids.flatMap(x => champIds.flatMap(y => meetings(c, x, y, RULES.recentWeeks).filter(e => e.res === 'W')));
    if (wins.length) { s += 2.5; reasons.push(`beat ${champName} ${ago(c, Math.max(...wins.map(e => e.wk)))}`); }
    const h = Math.max(0, ...k.ids.flatMap(x => champIds.map(y => heatOf(c, x, y))));
    if (h) { s += 1.2 * h; reasons.push(k.ids.some(x => champIds.some(y => lvl(c, 'grudge', x, y))) ? `a grudge against ${champName}` : `rivals with ${champName}`); }
    const want = k.team ? `Tag team gold with ${k.name}` : `Win the ${t.name}`;
    if (k.ids.some(x => goal(c, x) === want)) { s += 1; reasons.push(k.team ? 'chasing tag team gold' : `after the ${t.name}`); }
    const mo = mood(c, k.ids[0]);
    if (!k.team && mo.label === 'hot') { s += 1.5; reasons.push(`hot — ${mo.form.slice(-4)}`); }
    else if (!k.team && mo.label === 'rising') { s += 0.75; reasons.push('on the rise'); }
    // a shot already taken lately: lost - wait a while; no winner - unfinished business
    const shots = c.st.events.flatMap(e => e.matches.filter(m => m.status === 'played' && m.titleId === t.id
      && M.compareStamps(c.st, e.at, c.ev.at) < 0 && c.wk - weekNo(c.st, e.at) < 4
      && m.sides.some(sd => k.ids.every(id => sd.wrestlers.includes(id)))).map(m => ({ m, wk: weekNo(c.st, e.at) })));
    const last = shots.sort((a, b) => a.wk - b.wk).pop();
    if (last && last.m.outcome !== 'win') { s += 1; reasons.push(`no winner when they met for it ${ago(c, last.wk)}`); }
    else if (last && !last.m.sides[last.m.winner].wrestlers.some(id => k.ids.includes(id))) { s -= 2; reasons.push(`already had a shot ${ago(c, last.wk)}`); }
    return { ...k, s, reasons };
  }).sort((a, b) => b.s - a.s || a.name.localeCompare(b.name));
}
const caseFor = k => (k.reasons.length ? `${k.name}: ${k.reasons.slice(0, 3).join(', ')}` : `${k.name}: the best available contender`);

function titleIdeas(c) {
  const out = [];
  const st = c.st;
  titlesFor(c).forEach(t => {
    const reign = M.currentReign(st, t.id);
    if (!reign) { vacantIdeas(c, t, out); return; }
    const champIds = reign.holder.type === 'team' ? (M.teamById(st, reign.holder.id) || { members: [] }).members : [reign.holder.id];
    const champName = M.holderName(st, reign.holder);
    const here = champIds.filter(id => c.free.has(id));
    const need = t.kind === 'tag' ? 2 : 1;
    const list = contenders(c, t, champIds, champName);
    const idle = titleIdle(c, t, reign);
    const top = list.filter(k => k.s > -1);
    if (here.length < need) {
      const absent = champIds.some(id => (W(c, id) || {}).status !== 'active' || c.out.has(id));
      if (absent) contenderIdeas(c, t, top, out, `${champName} can’t defend tonight — the contenders settle who’s next`);
      return;
    }
    const champSide = t.kind === 'tag' ? { team: reign.holder.id, wrestlers: here.slice(0, 2) } : solo(here[0]);
    const lead = c.ple ? `${champName} ${champIds.length > 1 ? 'defend' : 'defends'} the ${t.name} at ${c.ev.name}`
      : idle >= 3 ? `The ${t.name} hasn’t been on the line for ${plural(idle, 'week')}`
        : `${champName} ${champIds.length > 1 ? 'defend' : 'defends'} the ${t.name}`;
    const base = c.ple ? 6 : 2 + (idle >= 4 ? 1 : idle <= 1 ? -1.5 : 0);
    const weight = (c.ple ? 9 : 7) + (t.kind === 'singles' ? 0.5 : 0);
    if (top[0]) {
      const k = top[0];
      const stip = stipFor(c, 'title', Math.max(0, ...k.ids.flatMap(x => champIds.map(y => heatOf(c, x, y)))), `${t.id}:${k.ids.join('+')}`);
      out.push(idea(c, 'title', [champSide, k.side], { titleId: t.id, stip: stip.stip, score: base + 0.8 * k.s, weight,
        why: [lead, `Challenger ${caseFor(k)}`, stip.why] }));
    }
    if (t.kind === 'singles' && top[1] && top[1].s >= top[0].s - 1.5) {
      out.push(idea(c, 'title', [champSide, top[0].side, top[1].side], { titleId: t.id, score: base - 0.3 + 0.4 * (top[0].s + top[1].s), weight,
        why: [`Two contenders with a claim to the ${t.name}`, caseFor(top[0]), caseFor(top[1])] }));
    }
    // the champion just defended: the contenders settle who's next
    contenderIdeas(c, t, top, out, idle <= 1 ? `The ${t.name} was just defended — the contenders settle who’s next` : null);
  });
  return out;
}

function contenderIdeas(c, t, top, out, lead) {
  const note = `#1 contender’s match for the ${t.name}`;
  if (top.length >= 2) {
    const [a, b] = top;
    out.push(idea(c, 'contender', [a.side, b.side], { notes: note, score: 1.5 + 0.5 * (a.s + b.s) / 2 + (lead ? 1 : 0), weight: 5.5,
      why: [lead || `The two leading contenders for the ${t.name}`, caseFor(a), caseFor(b)] }));
  }
  if (t.kind === 'singles' && top.length >= 4) {
    const four = top.slice(0, 4);
    out.push(idea(c, 'contender', four.map(k => k.side), { notes: note, score: 1 + 0.4 * four.reduce((n, k) => n + k.s, 0) / 4 + (lead ? 1 : 0), weight: 5.5,
      why: [lead || `Four contenders for the ${t.name}, one shot`, ...four.slice(0, 2).map(caseFor)] }));
  }
}

function vacantIdeas(c, t, out) {
  const list = contenders(c, t, [], 'the last champion');
  if (list.length < 2) return;
  const lead = `The ${t.name} is vacant`;
  const [a, b, x] = list;
  out.push(idea(c, 'vacant', [a.side, b.side], { titleId: t.id, notes: `For the vacant ${t.name}`, score: c.ple ? 6 : 3.5, weight: c.ple ? 9.5 : 7,
    why: [`${lead} — the top two contenders meet for it`, caseFor(a), caseFor(b)] }));
  if (t.kind === 'singles' && x) {
    out.push(idea(c, 'vacant', [a.side, b.side, x.side], { titleId: t.id, notes: `For the vacant ${t.name}`, score: c.ple ? 5.8 : 3.3, weight: c.ple ? 9.5 : 7,
      why: [`${lead} — three contenders for it`, caseFor(a), caseFor(b), caseFor(x)] }));
  }
}

// ---------------------------------------------------------------- stipulations

// a stipulation where a feud needs settling - never where the settings say not
function stipFor(c, kind, heat, key, { blowoff = false, tag = false } = {}) {
  const use = c.settings.stips;
  const due = use === 'often' ? heat >= 2 || blowoff : use === 'feuds' ? blowoff || (c.ple && heat >= 2) : false;
  if (!due || (kind === 'title' && !c.ple && use !== 'often')) return { stip: '', why: '' };
  const list = tag ? TAG_STIPS : c.ple ? PLE_STIPS : FEUD_STIPS;
  const stip = list[Math.floor(draw('stip', c.ev.id, c.nonce, key) * list.length)];
  return { stip, why: `${stip}: ${blowoff ? 'this feud needs settling' : `the heat between them is ${heat >= 3 ? 'at its peak' : 'high'}`}` };
}

// ---------------------------------------------------------------- feuds, allies and friends

function feudIdeas(c) {
  const out = [];
  const seen = new Set();
  [...c.d.rels.values()].filter(r => r.active && (r.kind === 'grudge' || r.kind === 'rivals')).forEach(r => {
    const [a, b] = [r.a, r.b].sort();
    const key = `${a}+${b}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (!c.free.has(a) || !c.free.has(b) || genderOf(c, [a, b]) === 'mixed' || partnered(c, a, b)) return;
    const heat = heatOf(c, a, b);
    const both = lvl(c, 'grudge', a, b) && lvl(c, 'grudge', b, a);
    const what = both ? `${nm(c, a)} and ${nm(c, b)} hold grudges against each other`
      : lvl(c, 'grudge', a, b) ? `${nm(c, a)} holds a grudge against ${nm(c, b)}`
        : lvl(c, 'grudge', b, a) ? `${nm(c, b)} holds a grudge against ${nm(c, a)}` : `${nm(c, a)} and ${nm(c, b)} are rivals`;
    const lead = `${what} (heat ${heat})`;
    const met = meetings(c, a, b, RULES.recentWeeks);
    const one = met.filter(x => isSingles(x.m));
    const last = met.length ? met[met.length - 1].wk : null;
    const lastOne = one.length ? one[one.length - 1].wk : null;
    const recentOnes = one.filter(x => c.wk - x.wk < 4).length;
    const blowoff = recentOnes >= 2 || (heat >= 3 && met.length >= 1);
    const hold = c.nextPle && !c.ple ? c.nextPle : null;         // a premium live event ahead: the singles match waits
    const justMet = lastOne != null && c.wk - lastOne <= 1;
    const revenge = [a, b].filter(x => goal(c, x) === `Revenge on ${nm(c, x === a ? b : a)}`);
    const revengeWhy = revenge.length ? `${nm(c, revenge[0])} wants revenge` : '';

    // the direct match
    let s = 2 + heat + (both ? 0.5 : 0) + (revenge.length ? 1 : 0);
    const why = [lead];
    if (c.ple) { s += 3; why.push(`The feud’s big match, at ${c.ev.name}`); }
    else if (hold) { s -= 3.5; why.push(`${hold.ev.name} is ${hold.weeks === 1 ? 'next week' : `in ${hold.weeks} weeks`} — this could wait for it`); }
    if (!meetings(c, a, b).some(x => isSingles(x.m))) { s += 1; why.push('They haven’t met one on one yet'); }
    if (recentOnes >= 2) why.push(`${plural(recentOnes, 'meeting')} in the last four weeks`);
    const stip = stipFor(c, 'feud', heat, key, { blowoff });
    if (recentOnes >= 2 && !stip.stip && !c.ple) s -= 2;
    if (stip.stip) s += 1;
    // at a premium live event, a feud with a champion in it is fought for the title
    const belt = c.ple ? titlesFor(c).find(t => t.kind === 'singles' && [[a, b], [b, a]].some(([x, y]) => {
      const r = M.currentReign(c.st, t.id);
      return r && r.holder.type === 'wrestler' && r.holder.id === x && fits(W(c, y), t);
    })) : null;
    if (belt) { s += 1; why.push(`The ${belt.name} on the line`); }
    why.push(revengeWhy, stip.why);
    out.push(idea(c, belt ? 'title' : 'feud', [solo(a), solo(b)], { titleId: belt ? belt.id : null, stip: stip.stip, score: s,
      weight: belt ? 9.5 : c.ple ? 8.5 : 6 + (stip.stip ? 1 : 0), why, feud: key }));

    // building it without giving the singles match away: each other's allies, partners, a tag match
    const build = justMet || hold ? 1.5 : 0;
    const buildWhy = justMet ? `They met one on one ${ago(c, lastOne)} — the feud builds another way this time`
      : hold ? `Building to ${hold.ev.name} in ${plural(hold.weeks, 'week')} without giving the singles match away` : '';
    const ba = backers(c, a, [b]).filter(x => !heatOf(c, x.id, a) && !bondOf(c, x.id, b));
    const bb = backers(c, b, [a]).filter(x => !heatOf(c, x.id, b) && !bondOf(c, x.id, a));
    [[a, b, bb], [b, a, ba]].forEach(([x, y, hers]) => hers.slice(0, 2).forEach(h => {
      out.push(idea(c, 'build', [solo(x), solo(h.id)], { score: 1.2 + 0.6 * heat + build + 0.2 * (h.bond || 1), weight: 5,
        why: [`Rivals face each other’s allies: ${nm(c, x)} against ${nm(c, h.id)}, ${nm(c, y)}’s ${h.how}`, lead, buildWhy], feud: key }));
    }));
    if (ba[0] && bb[0] && ba[0].id !== bb[0].id) {
      const sa = pairSide(c, a, ba[0].id), sb = pairSide(c, b, bb[0].id);
      const tstip = stipFor(c, 'tag', heat, `${key}:tag`, { tag: true });
      out.push(idea(c, 'build', [sa, sb], { stip: tstip.stip, score: 1.5 + 0.7 * heat + build + (sa.team && sb.team ? 0.5 : 0), weight: 5.5,
        why: [`${nm(c, a)} and ${nm(c, b)} on opposite sides, each with a ${ba[0].how === bb[0].how ? ba[0].how : 'partner'}`, lead, buildWhy, tstip.why],
        feud: key }));
    }
    // a friend stands up to a friend's rival
    [[a, b], [b, a]].forEach(([x, y]) => backers(c, x, [y]).filter(f => !f.partner && lvl(c, 'friends', x, f.id) && !bondOf(c, f.id, y)).slice(0, 1).forEach(f => {
      out.push(idea(c, 'defend', [solo(f.id), solo(y)], { score: 1.3 + 0.5 * lvl(c, 'friends', x, f.id) + 0.5 * heat + build * 0.5, weight: 5,
        why: [`${nm(c, f.id)} stands up for a friend: ${nm(c, x)}’s ${lvl(c, 'grudge', x, y) || lvl(c, 'grudge', y, x) ? 'feud' : 'rivalry'} with ${nm(c, y)}`, lead],
        feud: key }));
    }));
  });
  return out;
}

// ---------------------------------------------------------------- tag teams and factions

function teamIdeas(c) {
  const out = [];
  const teams = c.st.teams.filter(t => t.active && freeOf(c, t, 9).length >= 2)
    .map(t => ({ t, ids: freeOf(c, t, 9) })).filter(x => genderOf(c, x.ids) !== 'mixed');
  const teamHeat = (x, y) => Math.max(0, ...x.t.members.flatMap(p => y.t.members.map(q => heatOf(c, p, q))));
  teams.forEach((x, i) => teams.slice(i + 1).forEach(y => {
    if (x.t.members.some(id => y.t.members.includes(id)) || genderOf(c, x.ids) !== genderOf(c, y.ids)) return;
    const heat = teamHeat(x, y);
    const [rx, ry] = [c.teamRank.get(x.t.id), c.teamRank.get(y.t.id)];
    const why = [];
    let s = 1;
    if (heat) { s += heat; why.push(`${x.t.name} and ${y.t.name} are at odds (heat ${heat} between them)`); }
    if (rx && ry) {
      const close = 1 - Math.min(1, Math.abs(rx.score - ry.score) / 0.3);
      s += close;
      if (close >= 0.5) why.push(`Close in the tag team standings: #${rx.rank} and #${ry.rank}`);
    }
    const chasing = [x, y].find(z => z.t.members.some(id => goal(c, id) === `Tag team gold with ${z.t.name}`));
    if (chasing) { s += 0.5; why.push(`${chasing.t.name} are chasing tag team gold`); }
    const met = meetings(c, x.ids[0], y.ids[0], 2);
    if (met.length) s -= 1.5;
    if (!why.length) why.push(`${x.t.name} against ${y.t.name}: two teams on the show`);
    const tstip = stipFor(c, 'tag', heat, `${x.t.id}:${y.t.id}`, { tag: true });
    out.push(idea(c, 'teams', [{ team: x.t.id, wrestlers: x.ids.slice(0, 2) }, { team: y.t.id, wrestlers: y.ids.slice(0, 2) }],
      { stip: tstip.stip, score: s, weight: 5 + (heat ? 0.5 : 0), why: [...why, tstip.why] }));
    // factions: three on three
    if (x.ids.length >= 3 && y.ids.length >= 3) {
      out.push(idea(c, 'teams', [{ team: x.t.id, wrestlers: x.ids.slice(0, 3) }, { team: y.t.id, wrestlers: y.ids.slice(0, 3) }],
        { score: s + 0.3, weight: 6, why: [`Faction against faction: ${x.t.name} and ${y.t.name}`, ...why] }));
    }
    // tag partners face a member of the team they're at odds with
    if (heat) {
      const pairs = x.ids.flatMap(p => y.ids.map(q => [p, q])).sort((u, v) => heatOf(c, v[0], v[1]) - heatOf(c, u[0], u[1]));
      pairs.slice(0, 2).forEach(([p, q]) => {
        if (genderOf(c, [p, q]) === 'mixed') return;
        out.push(idea(c, 'teams', [solo(p), solo(q)], { score: 1 + 0.5 * heat + 0.3 * heatOf(c, p, q), weight: 4.5,
          why: [`${nm(c, p)} of ${x.t.name} against ${nm(c, q)} of ${y.t.name} — their teams are at odds`, ...why.slice(0, 1)] }));
      });
    }
  }));
  // outnumbered: someone with a grudge against a faction takes two of them on alone
  teams.filter(x => x.ids.length >= 2).forEach(x => [...c.free].filter(id => !x.t.members.includes(id) && genderOf(c, [id, ...x.ids]) !== 'mixed').forEach(id => {
    const h = Math.max(0, ...x.t.members.map(p => lvl(c, 'grudge', id, p)));
    if (h < 1 || backers(c, id).length) return;
    out.push(idea(c, 'teams', [solo(id), { team: x.t.id, wrestlers: x.ids.slice(0, 2) }], { score: 0.9 + 0.5 * h, weight: 4.5,
      why: [`${nm(c, id)} holds a grudge against ${x.t.name} — and has nobody to stand with`] }));
  }));
  return out;
}

// ---------------------------------------------------------------- results, balance, goals, arrivals

// a recent upset: a rematch, or a step up for whoever pulled it off
function upsetIdeas(c) {
  const out = [];
  const seen = new Set();
  [...c.free].forEach(id => (c.hist.get(id) || []).filter(x => c.wk - x.wk <= 2 && x.res === 'W' && isSingles(x.m)).forEach(x => {
    const loser = x.m.sides[1 - x.side].wrestlers[0];
    const [rw, rl] = [c.rank.get(id), c.rank.get(loser)];
    const champ = held(c, loser);
    const upset = (rw && rl && rw.rank >= rl.rank + 3) || (!held(c, id).length && champ.length);
    if (!upset || seen.has(`${id}>${loser}`)) return;
    seen.add(`${id}>${loser}`);
    const how = `${nm(c, id)} upset ${nm(c, loser)} ${ago(c, x.wk)}${rw && rl ? ` (#${rw.rank} over #${rl.rank})` : champ.length ? `, the ${champ[0].name} holder` : ''}`;
    if (c.free.has(loser)) {
      const proud = (W(c, loser) || { traits: [] }).traits.some(tr => tr === 'proud' || tr === 'hot-headed');
      out.push(idea(c, 'rematch', [solo(id), solo(loser)], { score: 2.2 + (proud ? 0.5 : 0), weight: 5,
        why: [`Rematch: ${how}`, proud ? `${nm(c, loser)} won’t let it go` : ''] }));
    }
    const g = (W(c, id) || {}).gender;
    [...c.free].filter(o => o !== id && o !== loser && (W(c, o) || {}).gender === g && (c.rank.get(o) || { rank: 99 }).rank <= 3)
      .slice(0, 2).forEach(o => {
        out.push(idea(c, 'step', [solo(id), solo(o)], { score: 1.8, weight: 4.5,
          why: [`A step up after an upset: ${how}`, `${nm(c, o)} is ${rankLine(c, o)}`] }));
      });
  }));
  return out;
}
const held = (c, id) => c.st.titles.filter(t => { const r = M.currentReign(c.st, t.id); return r && r.holder.type === 'wrestler' && r.holder.id === id; });

// someone short of matches gets a reasonable chance, against an opponent the rankings suggest
function chanceIdeas(c) {
  const out = [];
  c.balance.groups.forEach(g => g.rows.filter(r => r.flagged && (r.kind === 'team' || c.free.has(r.id))).forEach(r => {
    const ideas = SD.matchIdeas(c.st, { kind: r.kind, id: r.id }, { showId: c.showId, balanceResult: c.balance });
    const typical = Math.round(g.typical * r.weeks * 10) / 10;
    const short = `${r.name} ${r.kind === 'team' ? 'have' : 'has'} had ${plural(r.matches, 'match', 'matches')} in ${plural(r.weeks, 'week')} — about ${typical} is typical here`;
    ideas.forEach((x, i) => {
      // a team sends two of its free members; anyone else must be free tonight
      const sides = x.lineup.map(sd => ({ team: sd.team || null, wrestlers: sd.team ? sd.wrestlers.filter(id => c.free.has(id)).slice(0, 2) : sd.wrestlers }));
      if (sides.some(sd => sd.wrestlers.length < (r.kind === 'team' ? 2 : 1) || sd.wrestlers.some(id => !c.free.has(id)))) return;
      out.push(idea(c, 'chance', sides, { score: 1.8 + (r.severity === 'well below' ? 0.7 : 0) + 0.3 * x.score - 0.2 * i, weight: 3.5,
        why: [`A chance: ${short}`, x.reasons[0] ? `Against ${x.opponent.name}: ${x.reasons[0].charAt(0).toLowerCase()}${x.reasons[0].slice(1)}` : ''] }));
    });
  }));
  return out;
}

// someone cold gets a winnable-looking chance to turn it around - the game still decides
function turnIdeas(c) {
  const out = [];
  [...c.free].filter(id => mood(c, id).label === 'cold').forEach(id => {
    const me = c.rank.get(id);
    const g = (W(c, id) || {}).gender;
    [...c.free].filter(o => o !== id && (W(c, o) || {}).gender === g && mood(c, o).label !== 'hot' && !partnered(c, id, o))
      .map(o => ({ o, gap: me && c.rank.get(o) ? Math.abs(c.rank.get(o).rank - me.rank) : 5 }))
      .sort((a, b) => a.gap - b.gap || nm(c, a.o).localeCompare(nm(c, b.o))).slice(0, 2).forEach(({ o }) => {
        out.push(idea(c, 'turn', [solo(id), solo(o)], { score: 1.2, weight: 3,
          why: [`${nm(c, id)} is cold (${mood(c, id).form.slice(-5)}) — a chance to turn it around`, rankLine(c, o) ? `${nm(c, o)} is ${rankLine(c, o)}` : ''] }));
      });
  });
  return out;
}

// a new arrival - drafted, relegated or moved here lately - gets a first match on the show
function arrivalIdeas(c) {
  if (!c.showId) return [];
  const out = [];
  const tierNo = id => c.st.tiers.findIndex(t => t.shows.includes(id));
  c.st.moves.filter(mv => mv.to === c.showId && c.free.has(mv.wrestler) && c.wk - weekNo(c.st, mv.at) <= 2 && c.wk >= weekNo(c.st, mv.at)).forEach(mv => {
    const id = mv.wrestler;
    const since = (c.hist.get(id) || []).some(x => x.ev.showId === c.showId && M.compareStamps(c.st, x.ev.at, mv.at) > 0);
    const moves = M.movesOf(c.st, id);
    if (since || moves[moves.length - 1] !== mv) return;
    const from = mv.from ? M.showById(c.st, mv.from) : null;
    const how = c.st.drafts.some(x => x.move === mv.id) ? `drafted from ${from ? from.name : 'another show'}`
      : c.st.relegations.some(x => x.move === mv.id) ? `relegated from ${from ? from.name : 'another show'}`
        : from ? (tierNo(mv.from) > tierNo(c.showId) && tierNo(c.showId) >= 0 ? `up from ${from.name}` : `over from ${from.name}`) : 'new to the roster';
    const g = (W(c, id) || {}).gender;
    const pool = [...c.free].filter(o => o !== id && (W(c, o) || {}).gender === g && !held(c, o).length);
    const mid = pool.map(o => ({ o, r: (c.rank.get(o) || { rank: 50 }).rank })).sort((a, b) => Math.abs(a.r - 4) - Math.abs(b.r - 4) || nm(c, a.o).localeCompare(nm(c, b.o)));
    mid.slice(0, 2).forEach(({ o }) => out.push(idea(c, 'arrival', [solo(id), solo(o)], { score: 2, weight: 4,
      why: [`New arrival: ${nm(c, id)}, ${how} ${ago(c, weekNo(c.st, mv.at))} — a first match on ${c.show.name}`, rankLine(c, o) ? `${nm(c, o)} is ${rankLine(c, o)}` : ''] })));
  });
  return out;
}

// fresh matchups, so everyone on the roster has something: close in the standings, not met lately
function freshIdeas(c) {
  const out = [];
  const ids = [...c.free].sort();
  ids.forEach(a => {
    const g = (W(c, a) || {}).gender;
    const ra = c.rank.get(a);
    ids.filter(b => b !== a && (W(c, b) || {}).gender === g && !partnered(c, a, b) && !bondOf(c, a, b)).map(b => {
      const rb = c.rank.get(b);
      const close = ra && rb ? 1 - Math.min(1, Math.abs(ra.score - rb.score) / 0.3) : 0.3;
      const met = meetings(c, a, b);
      const last = met.length ? met[met.length - 1].wk : null;
      const both = `${nm(c, a)} and ${nm(c, b)}`;
      const why = [last != null && c.wk - last <= 2 ? `${both} are both free tonight — they met ${ago(c, last)}`
        : ra && rb && close >= 0.5 ? (ra.rank === rb.rank ? `Fresh matchup, level at #${ra.rank} in the ${division(g)} standings`
          : `Fresh matchup, close in the ${division(g)} standings: #${Math.min(ra.rank, rb.rank)} and #${Math.max(ra.rank, rb.rank)}`)
          : last == null ? `Fresh matchup: ${both} haven’t met` : `${both} are both free tonight — last met ${ago(c, last)}`];
      return { b, s: 0.3 + 0.8 * close + (last == null ? 0.3 : 0), why };
    }).filter(x => x.b > a).forEach(x => {
      out.push(idea(c, 'fresh', [solo(a), solo(x.b)], { score: x.s, weight: 2, why: x.why }));
    });
  });
  // three or four who haven't wrestled in a while, in one match
  M.GENDERS.forEach(g => {
    const idle = [...c.free].filter(id => (W(c, id) || {}).gender === g)
      .map(id => ({ id, gap: lastMatch(c, id) == null ? 9 : c.wk - lastMatch(c, id) })).filter(x => x.gap >= 2)
      .sort((a, b) => b.gap - a.gap || a.id.localeCompare(b.id));
    if (idle.length >= 3) {
      out.push(idea(c, 'multi', idle.slice(0, 3).map(x => solo(x.id)), { score: 0.9, weight: 3,
        why: [`Three who haven’t wrestled for a while: ${listOf(idle.slice(0, 3).map(x => nm(c, x.id)))}`] }));
    }
    if (idle.length >= 4) {
      out.push(idea(c, 'multi', idle.slice(0, 4).map(x => solo(x.id)), { score: 0.8, weight: 3,
        why: ['Four who haven’t wrestled for a while, in one match'] }));
    }
    // whoever's free, grouped by where they stand: a triple threat, a fatal 4-way or a tag match
    // when the show's mix wants one and nothing with more story to it fits
    const byRank = [...c.free].filter(id => (W(c, id) || {}).gender === g)
      .sort((x, y) => (c.rank.get(x) || { rank: 99 }).rank - (c.rank.get(y) || { rank: 99 }).rank || x.localeCompare(y));
    const at = id => (c.rank.get(id) ? `#${c.rank.get(id).rank} ${nm(c, id)}` : nm(c, id));
    byRank.forEach((_, i) => {
      const three = byRank.slice(i, i + 3), four = byRank.slice(i, i + 4);
      if (three.length === 3) {
        out.push(idea(c, 'fresh', three.map(solo), { score: 0.4, weight: 3,
          why: [`A triple threat, close in the ${division(g)} standings: ${listOf(three.map(at))}`] }));
      }
      if (four.length === 4) {
        out.push(idea(c, 'fresh', four.map(solo), { score: 0.3, weight: 3,
          why: [`A fatal 4-way, close in the ${division(g)} standings: ${listOf(four.map(at))}`] }));
        const [p, q, r, t] = four;
        out.push(idea(c, 'fresh', [pairSide(c, p, t), pairSide(c, q, r)], { score: 0.2, weight: 3,
          why: [`A tag match between four close in the ${division(g)} standings: ${listOf(four.map(at))}`] }));
      }
    });
    // the top of a division, all in at once
    const top = [...c.free].filter(id => (W(c, id) || {}).gender === g && c.rank.get(id) && !held(c, id).length)
      .sort((a, b) => c.rank.get(a).rank - c.rank.get(b).rank).slice(0, 3);
    if (top.length === 3) {
      out.push(idea(c, 'multi', top.map(solo), { score: 1.1, weight: 4.5,
        why: [`The top of the ${division(g)} standings in one match: ${top.map(id => `#${c.rank.get(id).rank} ${nm(c, id)}`).join(', ')}`] }));
    }
  });
  return out;
}

// ---------------------------------------------------------------- the card

function allIdeas(c) {
  const ideas = [...titleIdeas(c), ...feudIdeas(c), ...teamIdeas(c), ...upsetIdeas(c), ...chanceIdeas(c), ...turnIdeas(c),
    ...arrivalIdeas(c), ...freshIdeas(c)];
  // one idea per line-up and title: the best-scoring reason for it, with the others' reasons after its own
  const best = new Map();
  ideas.forEach(x => {
    const b = best.get(x.key);
    if (!b) { best.set(x.key, x); return; }
    const [top, other] = x.score > b.score ? [x, b] : [b, x];
    const leads = y => y.leads || [y.why[0]];
    best.set(x.key, other.kind === 'fresh' ? top
      : { ...top, leads: [...new Set([...leads(top), ...leads(other)])], why: [...new Set([...top.why, ...leads(other)])] });
  });
  return [...best.values()].filter(x => !c.passed.has(x.key) && x.people.length === new Set(x.people).size);
}

/** Every idea the booker weighed for an event, best first - what a draft is picked from. */
export function ideasFor(st, eventId, opts = {}) {
  const ev = M.eventById(st, eventId);
  return ev ? allIdeas(context(st, ev, opts)).sort((a, b) => b.score - a.score || a.key.localeCompare(b.key)) : [];
}

// how much someone needs a match tonight: weeks since their last one
function need(c, ids) {
  return ids.reduce((n, id) => {
    const last = lastMatch(c, id);
    return n + Math.min(4, last == null ? 4 : c.wk - last) * 0.15;
  }, 0) / Math.max(1, ids.length);
}

/**
 * Pick `slots` ideas that don't share anyone, leaning toward the show's mix of
 * match types and each division's share of who's available. `counted` are
 * matches already on the card or kept on the draft, which count toward both.
 */
function assemble(c, ideas, slots, counted, prefer = null) {
  const types = Object.fromEntries(Object.entries(c.settings.mix).map(([k, v]) => [k, MIX_WEIGHT[v]]));
  types.other = 0.2;
  const offered = new Set(ideas.map(x => x.type));
  const sum = Object.entries(types).filter(([k]) => offered.has(k)).reduce((n, [, w]) => n + w, 0) || 1;
  const genders = M.GENDERS.map(g => [g, [...c.free].filter(id => (W(c, id) || {}).gender === g).length]).filter(([, n]) => n >= 2);
  const people = genders.reduce((n, [, k]) => n + k, 0) || 1;
  const total = counted.length + slots;
  const count = { type: {}, gender: {}, feud: {}, titles: new Set() };
  const note = x => {
    count.type[x.type] = (count.type[x.type] || 0) + 1;
    count.gender[x.gender] = (count.gender[x.gender] || 0) + 1;
    if (x.feud) count.feud[x.feud] = (count.feud[x.feud] || 0) + 1;
    if (x.titleId) count.titles.add(x.titleId);
  };
  counted.forEach(m => note({ type: typeOf(m), gender: genderOf(c, inMatch(m)), titleId: m.titleId, feud: null }));
  const cap = c.ple ? Infinity : c.settings.titles;
  const used = new Set();
  const picked = [];
  const rate = x => {
    if (picked.includes(x) || x.people.some(id => used.has(id) || !c.free.has(id)) || !types[x.type]) return null;
    if (x.titleId && (count.titles.has(x.titleId) || count.titles.size >= cap)) return null;
    if (x.feud && (count.feud[x.feud] || 0) >= RULES.sameFeud) return null;
    let s = x.score + (draw('book', c.ev.id, c.nonce, x.key) - 0.5) * RULES.jitter;
    s += RULES.mixPull * ((types[x.type] / sum) * total - (count.type[x.type] || 0));
    const share = genders.find(([g]) => g === x.gender);
    if (share) s += RULES.divisionPull * ((share[1] / people) * total - (count.gender[x.gender] || 0));
    if (x.feud && count.feud[x.feud]) s -= 2;
    // a big match is welcome only while enough people are left to fill the rest of the card
    const left = c.free.size - used.size - x.people.length, after = slots - picked.length - 1;
    if (left < 2 * after && x.people.length > 2) s -= 3;
    s += need(c, x.people);
    if (prefer) s += (x.type === prefer.type ? 0.6 : 0) + (x.gender === prefer.gender ? 0.6 : 0);
    return s;
  };
  const bestOf = list => list.reduce((best, x) => { const s = rate(x); return s != null && (!best || s > best.s) ? { x, s } : best; }, null);
  for (let n = 0; n < slots; n++) {
    // nothing with more to it fits: whoever's left, in whatever kind of match the show allows
    const best = bestOf(ideas) || bestOf(filler(c, [...c.free].filter(id => !used.has(id)), types).filter(x => !c.passed.has(x.key)));
    if (!best) break;
    picked.push(best.x);
    best.x.people.forEach(id => used.add(id));
    note(best.x);
  }
  return picked;
}

// matches from whoever is left, closest in the standings first - the last resort for filling a card
function filler(c, left, types) {
  const out = [];
  M.GENDERS.forEach(g => {
    const ids = left.filter(id => (W(c, id) || {}).gender === g)
      .sort((x, y) => (c.rank.get(x) || { rank: 99 }).rank - (c.rank.get(y) || { rank: 99 }).rank || x.localeCompare(y));
    const who = n => listOf(ids.slice(0, n).map(id => nm(c, id)));
    const add = (type, n, sides, why) => { if (types[type] && ids.length >= n) out.push(idea(c, 'fresh', sides(ids.slice(0, n)), { score: 0, weight: 2, why: [why] })); };
    add('singles', 2, x => x.map(solo), `${who(2)} are both free tonight`);
    add('triple', 3, x => x.map(solo), `A triple threat for three who are free tonight: ${who(3)}`);
    add('fourway', 4, x => x.map(solo), `A fatal 4-way for four who are free tonight: ${who(4)}`);
    add('tag', 4, ([p, q, r, t]) => [pairSide(c, p, t), pairSide(c, q, r)], `A tag match for four who are free tonight: ${who(4)}`);
    add('trios', 6, x => [x.filter((_, i) => i % 2 === 0), x.filter((_, i) => i % 2)].map(ws => ({ team: null, wrestlers: ws })),
      `Six free tonight, three on three: ${who(6)}`);
  });
  return out;
}

// running order: the biggest match last, something with a crowd of people to open, the rest building up
function runningOrder(picked) {
  const list = [...picked].sort((a, b) => a.weight - b.weight || a.score - b.score);
  if (list.length < 3) return list;
  const main = list.pop();
  const opener = list.findIndex(x => x.type !== 'singles');
  if (opener > 0) list.unshift(list.splice(opener, 1)[0]);
  return [...list, main];
}

/** A drafted idea as the model takes it: a line-up, its stakes, and why. */
export function toSpec(x) {
  return { sides: x.sides, titleId: x.titleId, stip: x.stip, notes: x.notes, auto: { kind: x.kind, key: x.key, why: x.why.slice(0, 4) } };
}

/**
 * A draft card for an event: { size, slots, matches, short }. `matches` are
 * ideas in running order, each with its reasons; `short` says why the card
 * came up short of its size, when it did. `keep` are draft matches staying on
 * it (their wrestlers are taken). Nothing is stored - see model.setDraft.
 */
export function draftCard(st, eventId, { nonce = 0, keep = [] } = {}) {
  const ev = M.eventById(st, eventId);
  if (!ev) return { size: 0, slots: 0, matches: [], short: 'That show isn’t on the calendar.' };
  const c = context(st, ev, { nonce, keep });
  const slots = c.size - ev.matches.length - keep.length;
  const where = c.show ? c.show.name : 'the roster';
  if (slots <= 0) return { size: c.size, slots: 0, matches: [], short: `The card already holds ${plural(ev.matches.length + keep.length, 'match', 'matches')} of ${c.size}.` };
  const picked = runningOrder(assemble(c, allIdeas(c), slots, [...ev.matches, ...keep]));
  const away = c.roster.length - c.avail.length;
  const short = picked.length >= slots ? null
    : !picked.length ? `Nothing fits: ${c.free.size ? `only ${plural(c.free.size, 'wrestler')}` : 'nobody'} available on ${where}${away ? ` (${away} injured, away or out)` : ''}.`
      : `Only ${plural(picked.length, 'match', 'matches')} ${picked.length === 1 ? 'fits' : 'fit'} with ${plural(c.free.size, 'wrestler')} available on ${where}${away ? ` (${away} injured, away or out)` : ''}.`;
  return { size: c.size, slots, matches: picked, short };
}

/**
 * The whole draft drawn again, keeping what the owner changed or added:
 * a list for model.setDraft, with kept matches where they were and new ones
 * in the gaps. { list, nonce, short }.
 */
export function redraft(st, eventId) {
  const ev = M.eventById(st, eventId);
  const d = ev && ev.draft;
  if (!d) return { list: [], nonce: 0, short: null };
  const keep = d.matches.filter(x => !x.auto || x.auto.edited);
  const nonce = d.nonce + 1;
  const res = draftCard(st, eventId, { nonce, keep });
  const fresh = [...res.matches];
  const list = d.matches.map(x => (keep.includes(x) ? { keep: x.id } : fresh.length ? toSpec(fresh.shift()) : null)).filter(Boolean);
  fresh.forEach(x => list.push(toSpec(x)));
  return { list, nonce, short: res.short };
}

/** Another match for one place on the draft - nobody else on the card or the draft, and not what was there. Null when nothing fits. */
export function redrawOne(st, eventId, dmId) {
  const ev = M.eventById(st, eventId);
  const d = ev && ev.draft;
  const dm = d && d.matches.find(x => x.id === dmId);
  if (!dm) return null;
  const others = d.matches.filter(x => x !== dm);
  const c = context(st, ev, { nonce: d.nonce + d.passed.length + 1, keep: others });
  const old = dm.auto ? dm.auto.key : matchKey(dm);
  const ideas = allIdeas(c).filter(x => x.key !== old && x.key !== matchKey(dm));
  const picked = assemble(c, ideas, 1, [...ev.matches, ...others], { type: typeOf(dm), gender: genderOf(c, inMatch(dm)) });
  return picked[0] || null;
}

// ---------------------------------------------------------------- worth a look before booking

/**
 * Anything on a draft (or card) that needs a second look: someone injured,
 * away, out tonight, on another show now, or in two matches; a title match
 * without its champion. Never blocks booking. Map of draft match id -> [text].
 */
export function draftNotes(st, ev) {
  const out = new Map();
  if (!ev.draft) return out;
  const count = new Map();
  [...ev.matches, ...ev.draft.matches].forEach(m => inMatch(m).forEach(id => count.set(id, (count.get(id) || 0) + 1)));
  ev.draft.matches.forEach(dm => {
    const notes = [];
    inMatch(dm).forEach(id => {
      const w = M.wrestlerById(st, id);
      if (!w) return;
      if (w.status !== 'active') notes.push(`${w.name} is ${w.status}`);
      else if (ev.draft.out.includes(id)) notes.push(`${w.name} isn’t at this show`);
      if (ev.showId && w.showId !== ev.showId) notes.push(`${w.name} is on ${w.showId ? M.showById(st, w.showId).name : 'no show'} now`);
      if (count.get(id) > 1) notes.push(`${w.name} is in another match on this card`);
    });
    const t = dm.titleId && M.titleById(st, dm.titleId);
    const r = t && M.currentReign(st, t.id);
    if (t && !t.active) notes.push(`The ${t.name} is retired`);
    if (r && !dm.sides.some(sd => (r.holder.type === 'team' ? sd.team === r.holder.id : sd.wrestlers.includes(r.holder.id)))) {
      notes.push(`The ${t.name} ${r.holder.type === 'team' ? 'champions' : 'champion'}, ${M.holderName(st, r.holder)}, ${r.holder.type === 'team' ? 'aren’t' : 'isn’t'} in it`);
    }
    if (notes.length) out.set(dm.id, [...new Set(notes)]);
  });
  return out;
}

/** The week's shows, and what drafting the week would do with each: [{ show, event, action, text }]. */
export function weekPlan(st, week) {
  const season = M.activeSeason(st);
  const evs = st.events.filter(e => e.at.season === season.id && e.at.week === week);
  const rows = [];
  st.shows.forEach(sh => {
    const e = evs.find(x => x.kind === 'weekly' && x.showId === sh.id) || null;
    const avail = st.wrestlers.filter(w => w.showId === sh.id && w.status === 'active').length;
    rows.push({ show: sh, event: e, day: e ? e.at.day : sh.day, ...planFor(st, e, avail, sh.name) });
  });
  evs.filter(e => e.kind === 'ple').forEach(e => {
    const avail = st.wrestlers.filter(w => (e.showId ? w.showId === e.showId : !!w.showId) && w.status === 'active').length;
    rows.push({ show: e.showId ? M.showById(st, e.showId) : null, event: e, day: e.at.day, ...planFor(st, e, avail, e.name) });
  });
  return rows.sort((a, b) => a.day - b.day);
}
function planFor(st, e, avail, name) {
  if (avail < 2) return { action: 'skip', text: `${avail ? 'Only one wrestler' : 'Nobody'} available on ${name}` };
  if (!e) return { action: 'plan', text: 'Plan the episode and draft its card' };
  const cs = M.cardStatus(e);
  if (cs.played) return { action: 'skip', text: 'Results are in — nothing to draft' };
  if (e.draft) return { action: 'skip', text: 'A draft is waiting — draw it again from its page' };
  const size = M.cardSize(st, e);
  if (cs.total >= size) return { action: 'skip', text: `Already booked: ${plural(cs.total, 'match', 'matches')}` };
  return { action: 'draft', text: cs.total ? `Draft the rest: ${cs.total} of ${size} booked` : `Draft ${plural(size, 'match', 'matches')}` };
}
