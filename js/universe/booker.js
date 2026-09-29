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
// The story director's events are canon, and they drive it (storylines.js):
// an attack makes a revenge match likely, a save a tag match, a betrayal a
// feud, a confrontation before the show a match that night, a title demand a
// title match; a rival's partner - or a friend, once it's hot enough - is drawn
// in only with a reason, and every such connection is spelled out. Big events
// fade over weeks rather than being forgotten after one. It tracks what each
// feud has already done, who has faced whom lately and in what kind of match,
// so cards don't repeat - and now and then allows one unexpected pairing, with
// a hook that makes sense of it.
//
// What it never does: pick a winner, simulate a match, book anything, or make a
// story event. It returns ideas, each with its reasons; the draft (model.js)
// is the owner's to change, and only booking it puts it on the card. Results
// come from the game; once they're in, everything here is worked out again
// from them.
//
// Pure: no DOM, no storage, no clock. Close calls are broken by a hash of the
// event, the draw number and the match, so the same save drafts the same card
// and drawing again draws a different one.
import * as M from './model.js';
import * as RL from './relations.js';
import * as SD from './standings.js';
import * as SL from './storylines.js';
import { draw, goalOf, history, momentumOf, weekNo } from './director.js';

export const TYPE_LABEL = { singles: 'Singles', tag: 'Tag team', triple: 'Triple threat', fourway: 'Fatal 4-way', trios: '6-person tag', handicap: 'Handicap' };
export const LEVEL_LABEL = { often: 'Often', sometimes: 'Sometimes', rarely: 'Rarely', never: 'Never' };
export const STIP_LABEL = { never: 'Never', feuds: 'Settling feuds', often: 'Often' };
export const KIND_LABEL = {
  title: 'Title match', vacant: 'Vacant title', contender: 'Contenders', feud: 'Feud', build: 'Feud builds', defend: 'Friend steps in',
  teams: 'Teams collide', rematch: 'Rematch', step: 'Step up', chance: 'Opportunity', turn: 'Turn it around', arrival: 'New arrival',
  fresh: 'Fresh matchup', 'multi': 'Multi-person', hook: 'From the story', surprise: 'Surprise',
};
// ideas whose line-up is the story itself: meeting again is the point, and storylines.js already spaces it out
const STORY_KINDS = new Set(['feud', 'build', 'defend', 'rematch', 'title', 'hook', 'vacant']);
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
/** The key a drafted match goes by: who's in it and what's at stake (a title, or a #1 contender's spot for one). */
export const matchKey = m => `${m.titleId || (m.contender ? `#${m.contender}` : '-')}:${lineupKey(m.sides)}`;
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
  const d = RL.relationships(st);
  const hist = history(st, ev.at);
  // the story so far: every story event up to tonight (tonight's only if before the show), and the storylines it makes
  const onRoster = new Set(roster.map(w => w.id));
  const recent = M.allIncidents(st).filter(x => M.compareStamps(st, x.event.at, ev.at) <= 0 && (x.event.id !== ev.id || x.incident.phase === 'pre'))
    .map(x => ({ ...x, wk: weekNo(st, x.event.at) })).filter(x => wk - x.wk < SL.RULES.window);
  return {
    st, ev, showId, settings, ple, nonce, keep, taken, out, roster, avail, free, wk, rank, teamRank,
    size: ple ? settings.pleSize : settings.size,
    show: showId ? M.showById(st, showId) : null,
    d, hist, recent,
    lines: SL.storylines(st, { at: ev.at, d, hist }),
    seen: recent.filter(x => [...x.incident.by, ...x.incident.on, ...x.incident.helped].some(id => onRoster.has(id))).map(x => x.incident.id),
    surprise: draw('surprise', ev.id, nonce) < (SURPRISE[st.story.pace] || SURPRISE.normal),
    types: new Map(),
    lineups: recentLineups(st, hist, wk),
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
function idea(c, kind, sides, { titleId = null, contender = null, stip = '', notes = '', score, weight = 3, why = [], feud = null, events = [] }) {
  const m = { sides: sides.map(sd => ({ team: sd.team || null, wrestlers: [...sd.wrestlers] })), titleId, contender };
  const people = inMatch(m);
  const type = typeOf(m);
  let s = score;
  const extra = [];
  // the same opponents again so soon, in any kind of match, needs a story behind it
  if (!STORY_KINDS.has(kind)) {
    let again = 0;
    m.sides.forEach((sd, i) => m.sides.slice(i + 1).forEach(other => sd.wrestlers.forEach(p => other.wrestlers.forEach(q => { if (meetings(c, p, q, 3).length) again++; }))));
    s -= Math.min(2, 0.8 * again);
  }
  // the same kind of match over and over: someone whose last three were all this kind sits it out; a change is welcome
  const story = STORY_KINDS.has(kind) || kind === 'teams';
  const stale = people.filter(p => { const t = lastTypes(c, p); return t.length === 3 && t.every(x => x === type); });
  s -= (story ? 0.4 : 1) * stale.length / people.length;
  const change = story && people.find(p => { const t = lastTypes(c, p); return t.length === 3 && t.every(x => x === t[0] && x !== type); });
  if (change) { s += 0.3; extra.push(`${nm(c, change)}’s last three matches were ${TYPE_LABEL[lastTypes(c, change)[0]] ? TYPE_LABEL[lastTypes(c, change)[0]].toLowerCase() : 'the same kind'} — something different this time`); }
  // the same match every week is exactly what a card shouldn't be - in any format (a rematch after an upset aside)
  const last = kind === 'rematch' ? null : c.lineups.get(lineupKey(m.sides));
  if (last != null && c.wk - last <= 1) s -= 2.5;
  else if (last != null && c.wk - last <= 2) s -= 1;
  return { key: matchKey(m), kind, type, gender: genderOf(c, people), sides: m.sides, titleId, contender, stip, notes,
    score: s, weight, why: [...why, ...extra].filter(Boolean), feud, people, events: [...new Set(events)] };
}
// every line-up played lately, by who was in it (title aside): the week it last happened
function recentLineups(st, hist, wk) {
  const out = new Map();
  hist.forEach(list => list.forEach(x => {
    if (wk - x.wk > 2) return;
    const k = lineupKey(x.m.sides);
    if (!out.has(k) || out.get(k) < x.wk) out.set(k, x.wk);
  }));
  return out;
}
// the kinds of match someone had last, oldest first (up to three)
function lastTypes(c, id) {
  if (!c.types.has(id)) c.types.set(id, (c.hist.get(id) || []).slice(-3).map(x => typeOf(x.m)));
  return c.types.get(id);
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
  const nc = M.numberOneContender(st, t.id);
  return pool.map(k => {
    const reasons = [];
    let s = 0;
    const rk = k.team ? c.teamRank.get(k.team) : c.rank.get(k.ids[0]);
    // whoever won the #1 contender's match has earned the next shot
    if (nc &&(nc.holder.type === 'team' ? nc.holder.id === k.team : !k.team && nc.holder.id === k.ids[0])) {
      s += 5;
      reasons.push(`#1 contender — won the #1 contender’s match ${ago(c, weekNo(st, nc.event.at))}`);
      k.earned = true;
    }
    if (rk && rk.rank === 1) { s += 2; reasons.push(k.team ? '#1 in the tag team standings' : rankLine(c, k.ids[0])); }
    else if (rk && rk.rank <= 3) { s += 1; reasons.push(k.team ? `#${rk.rank} in the tag team standings` : rankLine(c, k.ids[0])); }
    const wins = k.ids.flatMap(x => champIds.flatMap(y => meetings(c, x, y, RULES.recentWeeks).filter(e => e.res === 'W')));
    if (wins.length) { s += 2.5; reasons.push(`beat ${champName} ${ago(c, Math.max(...wins.map(e => e.wk)))}`); }
    // a win over one of the top three lately, from further down: that's a case too
    else if (!k.team) {
      const top3 = (c.hist.get(k.ids[0]) || []).filter(e => c.wk - e.wk <= 2 && e.res === 'W')
        .flatMap(e => e.m.sides.filter((_, i) => i !== e.side).flatMap(sd => sd.wrestlers).map(id => ({ id, wk: e.wk })))
        .find(x => !champIds.includes(x.id) && c.rank.get(x.id) && c.rank.get(x.id).rank <= 3 && (!rk || rk.rank > c.rank.get(x.id).rank));
      if (top3) { s += 1.5; reasons.push(`beat #${c.rank.get(top3.id).rank} ${nm(c, top3.id)} ${ago(c, top3.wk)}`); }
    }
    const h = Math.max(0, ...k.ids.flatMap(x => champIds.map(y => heatOf(c, x, y))));
    if (h) { s += 1.2 * h; reasons.push(k.ids.some(x => champIds.some(y => lvl(c, 'grudge', x, y))) ? `a grudge against ${champName}` : `rivals with ${champName}`); }
    const want = k.team ? `Tag team gold with ${k.name}` : `Win the ${t.name}`;
    if (k.ids.some(x => goal(c, x) === want)) { s += 1; reasons.push(k.team ? 'chasing tag team gold' : `after the ${t.name}`); }
    const mo = mood(c, k.ids[0]);
    if (!k.team && mo.label === 'hot') { s += 1.5; reasons.push(`hot — ${mo.form.slice(-4)}`); }
    else if (!k.team && mo.label === 'rising') { s += 0.75; reasons.push('on the rise'); }
    // the story: a demand or a challenge for it, a run everyone noticed, a title lost lately
    const told = c.recent.filter(x => c.wk - x.wk <= 4 && x.incident.by.some(id => k.ids.includes(id)));
    const asked = told.filter(x => (x.incident.kind === 'demand' || x.incident.kind === 'challenge')
      && (x.incident.title === t.id || x.incident.on.some(id => champIds.includes(id)))).pop();
    // (story reasons lead the case: they're why this contender, now)
    if (asked) { s += 3; reasons.unshift(`${asked.incident.kind === 'demand' ? 'demanded a shot' : 'laid down the challenge'} ${ago(c, asked.wk)}`); k.events = [asked.incident.id]; }
    const run = told.filter(x => x.incident.kind === 'momentum').pop();
    if (run) { s += 1; reasons.splice(asked ? 1 : 0, 0, 'on a run everyone’s talking about'); k.events = [...(k.events || []), run.incident.id]; }
    const lost = st.reigns.find(r => r.titleId === t.id && r.end && c.wk - weekNo(st, r.end) <= 4 && M.compareStamps(st, r.end, c.ev.at) <= 0
      && (r.holder.type === 'team' ? r.holder.id === k.team : k.ids.includes(r.holder.id)));
    if (lost) { s += 2.5; reasons.unshift(`lost the title ${ago(c, weekNo(st, lost.end))} and wants it back`); }
    // a storyline with the champion: its story event is the case
    const line = !k.team && champIds.length === 1 ? SL.storyOf(c.lines, k.ids[0], champIds[0]) : null;
    if (line) k.feud = line.key;                       // a title match between them is a chapter of their feud
    // they met one on one last week: the title match can wait while the feud builds another way
    const metLately = champIds.length === 1 && !k.team && meetings(c, k.ids[0], champIds[0], 2).some(e => isSingles(e.m) && c.wk - e.wk <= 1);
    if (metLately) k.metLately = true;
    if (line && line.hook && c.wk - line.hook.wk <= 4) {
      s += 1 + line.hook.weight * 0.3;
      k.hook = hookText(c, line.hook);
      k.events = [...(k.events || []), ...storyEvents(line)];
    }
    // a shot already taken lately: lost - wait a while; no winner - unfinished business
    const shots = c.st.events.flatMap(e => e.matches.filter(m => m.status === 'played' && m.titleId === t.id
      && M.compareStamps(c.st, e.at, c.ev.at) < 0 && c.wk - weekNo(c.st, e.at) < 4
      && m.sides.some(sd => k.ids.every(id => sd.wrestlers.includes(id)))).map(m => ({ m, wk: weekNo(c.st, e.at) })));
    const last = shots.sort((a, b) => a.wk - b.wk).pop();
    if (last && last.m.outcome !== 'win') { s += 1; reasons.push(`no winner when they met for it ${ago(c, last.wk)}`); }
    else if (last && !last.m.sides[last.m.winner].wrestlers.some(id => k.ids.includes(id))) { s -= 2; reasons.push(`already had a shot ${ago(c, last.wk)}`); k.lostShot = last.wk; }
    return { ...k, s, reasons, events: k.events || [], hook: k.hook || '', feud: k.feud || null, lostShot: k.lostShot == null ? null : k.lostShot,
      metLately: !!k.metLately, earned: !!k.earned };
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
    // anyone who lost a shot at it in the last two weeks waits their turn
    // ...and so does anyone who met the champion one on one last week: the feud builds another way first
    const top = list.filter(k => k.s > -1 && !(k.lostShot != null && c.wk - k.lostShot <= 2) && (!k.metLately || k.earned));
    // someone has already earned the next shot: no more #1 contender's matches until they've had it
    const waiting = M.numberOneContender(st, t.id);
    if (here.length < need) {
      const absent = champIds.some(id => (W(c, id) || {}).status !== 'active' || c.out.has(id));
      if (absent && !waiting) contenderIdeas(c, t, top, out, `${champName} can’t defend tonight — the contenders settle who’s next`);
      return;
    }
    const champSide = t.kind === 'tag' ? { team: reign.holder.id, wrestlers: here.slice(0, 2) } : solo(here[0]);
    const lead = c.ple ? `${champName} ${champIds.length > 1 ? 'defend' : 'defends'} the ${t.name} at ${c.ev.name}`
      : idle >= 3 ? `The ${t.name} hasn’t been on the line for ${plural(idle, 'week')}`
        : `${champName} ${champIds.length > 1 ? 'defend' : 'defends'} the ${t.name}`;
    // a champion's open challenge: somebody answers it
    const open = c.recent.filter(x => x.incident.kind === 'open-challenge' && c.wk - x.wk <= 2 && x.incident.by.some(id => champIds.includes(id))
      && (!x.incident.title || x.incident.title === t.id)).pop();
    const base = (c.ple ? 6 : 2 + (idle >= 4 ? 1 : idle <= 1 ? -1.5 : 0)) + (open ? 2 : 0);
    const weight = (c.ple ? 9 : 7) + (t.kind === 'singles' ? 0.5 : 0);
    if (top[0]) {
      const k = top[0];
      const stip = stipFor(c, 'title', Math.max(0, ...k.ids.flatMap(x => champIds.map(y => heatOf(c, x, y)))), `${t.id}:${k.ids.join('+')}`);
      out.push(idea(c, 'title', [champSide, k.side], { titleId: t.id, stip: stip.stip, score: base + 0.8 * k.s, weight,
        why: [open ? `${champName} laid down an open challenge ${when(c, { ev: open.event, wk: open.wk })} — ${k.name} answers it`
          : k.earned ? `${k.name} earned the shot: ${k.reasons[0]}` : k.hook || lead,
          `Challenger ${caseFor(k)}`, k.hook ? lead : '', stip.why], events: [...k.events, ...(open ? [open.incident.id] : [])], feud: k.feud }));
    }
    if (t.kind === 'singles' && top[1] && top[1].s >= top[0].s - 1.5) {
      out.push(idea(c, 'title', [champSide, top[0].side, top[1].side], { titleId: t.id, score: base - 0.3 + 0.4 * (top[0].s + top[1].s), weight,
        why: [`Two contenders with a claim to the ${t.name}`, caseFor(top[0]), caseFor(top[1])], events: [...top[0].events, ...top[1].events] }));
    }
    // the champion just defended: the contenders settle who's next
    if (!waiting) contenderIdeas(c, t, top, out, idle <= 1 ? `The ${t.name} was just defended — the contenders settle who’s next` : null);
  });
  return out;
}

// a #1 contender's match: its winner is next in line for the title
function contenderIdeas(c, t, top, out, lead) {
  if (top.length >= 2) {
    const [a, b] = top;
    out.push(idea(c, 'contender', [a.side, b.side], { contender: t.id, score: 1.5 + 0.5 * (a.s + b.s) / 2 + (lead ? 1 : 0), weight: 5.5,
      why: [lead || `The two leading contenders for the ${t.name}`, caseFor(a), caseFor(b)], events: [...a.events, ...b.events] }));
  }
  if (t.kind === 'singles' && top.length >= 4) {
    const four = top.slice(0, 4);
    out.push(idea(c, 'contender', four.map(k => k.side), { contender: t.id, score: 1 + 0.4 * four.reduce((n, k) => n + k.s, 0) / 4 + (lead ? 1 : 0), weight: 5.5,
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

// ---------------------------------------------------------------- storylines: feuds, allies and friends
//
// Every feud is a storyline (storylines.js): its beats, how often it has
// advanced and in which formats, how pressing it is now, who has been drawn in
// and why. The next chapter is picked to move it on: the story event behind it
// makes the match likely - tonight's confrontation most of all - a feud that
// just met one on one moves on through partners or a tag match, one due a
// blow-off gets a stipulation, one settled lately cools off, and an upset
// sends the loser after it again. Someone joins in only with a reason.

// how a story beat reads as the reason for a match
const when = (c, b) => (b.ev.id === c.ev.id ? 'before the show tonight' : ago(c, b.wk));
const HOOK = {
  attack: (c, b) => `Revenge: ${nm(c, b.by)} attacked ${nm(c, b.on)} ${when(c, b)}`,
  betrayal: (c, b) => `Betrayal: ${nm(c, b.by)} turned on ${nm(c, b.on)} ${when(c, b)}`,
  brawl: (c, b) => `${nm(c, b.by)} and ${nm(c, b.on)} brawled ${when(c, b)} — it needs settling in the ring`,
  confrontation: (c, b) => `${nm(c, b.by)} confronted ${nm(c, b.on)} ${when(c, b)}`,
  interference: (c, b) => `${nm(c, b.by)} interfered against ${nm(c, b.on)} ${when(c, b)} — ${nm(c, b.on)} wants a piece of ${nm(c, b.by)}`,
  save: (c, b) => `${nm(c, b.by)} spoiled ${nm(c, b.on)}’s attack ${when(c, b)} — ${nm(c, b.on)} wants the one who made the save`,
  breakup: (c, b) => `Former partners: ${nm(c, b.by)} walked out on ${nm(c, b.on)} ${when(c, b)}`,
  tension: (c, b) => `${nm(c, b.by)} and ${nm(c, b.on)} have been clashing — it boils over`,
  challenge: (c, b) => `${nm(c, b.by)} challenged ${nm(c, b.on)} ${when(c, b)}`,
  demand: (c, b) => `${nm(c, b.by)} called out ${nm(c, b.on)} ${when(c, b)}`,
};
const hookText = (c, b) => (HOOK[b.kind] ? HOOK[b.kind](c, b) : b.text);
function heatText(c, l) {
  const [A, B] = [nm(c, l.a), nm(c, l.b)];
  const what = l.mutual ? `${A} and ${B} hold grudges against each other`
    : lvl(c, 'grudge', l.a, l.b) ? `${A} holds a grudge against ${B}` : lvl(c, 'grudge', l.b, l.a) ? `${B} holds a grudge against ${A}`
      : l.heat ? `${A} and ${B} are rivals` : `${A} and ${B} are at odds`;
  return l.heat ? `${what} (heat ${l.heat})` : what;
}
// how often the feud has advanced, and how
function chapterLine(c, l) {
  const [A, B] = [nm(c, l.a), nm(c, l.b)];
  if (!l.chapters) return `The first chapter in the ring for ${A} and ${B}`;
  const past = l.beats.filter(b => b.kind === 'match').slice(-3).map(b => `${SL.FORMAT_LABEL[b.format]} ${ago(c, b.wk)}`);
  return `Chapter ${l.chapters + 1} of ${A} vs ${B} — so far: ${past.join(', ')}`;
}
const storyEvents = l => [...new Set(l.beats.filter(b => b.incident && b.weight > 0).slice(-4).map(b => b.incident))];
const sameDivision = (c, ...ids) => genderOf(c, ids) !== 'mixed';

function storyIdeas(c) {
  const out = [];
  c.lines.forEach(l => {
    const { a, b, key } = l;
    if (l.priority < 0.5) return;
    const events = storyEvents(l);
    const tonight = l.beats.find(x => x.incident && x.ev.id === c.ev.id && ['confrontation', 'brawl', 'attack', 'challenge', 'demand'].includes(x.kind));
    const hook = l.hook && c.wk - l.hook.wk <= 6 ? l.hook : null;
    const lead = tonight ? `${hookText(c, tonight)} — the match is tonight` : hook ? hookText(c, hook) : heatText(c, l);
    const chapter = chapterLine(c, l);
    const lastDirect = l.beats.filter(x => x.kind === 'match' && x.format !== 'proxy').pop();
    const justMet = lastDirect && lastDirect.format === 'singles' && c.wk - lastDirect.wk <= 1;
    const twoInARow = l.formats.length >= 2 && l.formats.slice(-2).every(f => f === 'singles');
    // the same way twice running, lately: that way waits, and the others are welcome
    const rut = l.formats.length >= 2 && l.formats.slice(-2).every(f => f === l.formats[l.formats.length - 1])
      && lastDirect && c.wk - l.beats.filter(x => x.kind === 'match').pop().wk <= 2 ? l.formats[l.formats.length - 1] : null;
    const hold = c.nextPle && !c.ple && !tonight ? c.nextPle : null;
    const due = l.stage === 'peak' && !justMet;
    const upset = l.upset && l.upset.winner ? `${l.upset.text.replace(/ at [^—]*$/, '')} ${ago(c, l.upset.wk)} — nobody saw it coming, and it isn’t over` : '';

    // one on one
    if (c.free.has(a) && c.free.has(b) && sameDivision(c, a, b) && !partnered(c, a, b)) {
      let s = 1.5 + 0.7 * l.priority;
      const why = [lead, chapter];
      if (tonight) s += 4;
      if (l.settled) { s -= 4; why.push(`Settled lately (${l.settled.text}) — the feud is cooling off`); }
      if (c.ple) { s += 3; why.push(`The feud’s big match, at ${c.ev.name}`); }
      else if (hold) { s -= 3.5; why.push(`${hold.ev.name} is ${hold.weeks === 1 ? 'next week' : `in ${hold.weeks} weeks`} — this could wait for it`); }
      if (justMet) s -= 3;
      else if (twoInARow) s -= 1.5;
      else if (rut && rut !== 'singles') { s += 1; why.push(`${SL.FORMAT_LABEL[rut].replace(/^./, x => x.toUpperCase())} twice running — this time one on one`); }
      if (upset) { s += 1.5; why.push(upset); }
      if (!l.direct) { s += 0.5; why.push('They haven’t met in the ring yet'); }
      const revenge = [a, b].find(x => goal(c, x) === `Revenge on ${nm(c, x === a ? b : a)}`);
      if (revenge) { s += 1; why.push(`${nm(c, revenge)} wants revenge`); }
      // a third meeting in four weeks, a feud that's run its chapters, or one at its hottest: settle it
      const lately = l.beats.filter(x => x.kind === 'match' && x.format === 'singles' && c.wk - x.wk < 4).length;
      if (lately >= 2) why.push(`${plural(lately, 'meeting')} in the last four weeks`);
      const stip = stipFor(c, 'feud', l.heat, key, { blowoff: due && (c.ple || lately >= 2 || l.direct >= SL.RULES.peakChapters || l.priority >= 7) });
      if (lately >= 2 && !stip.stip && !c.ple) s -= 2;
      if (stip.stip) { s += 1; why.push(stip.why); }
      // at a premium live event, a feud with a champion in it is fought for the title
      const belt = c.ple ? titlesFor(c).find(t => t.kind === 'singles' && [[a, b], [b, a]].some(([x, y]) => {
        const r = M.currentReign(c.st, t.id);
        return r && r.holder.type === 'wrestler' && r.holder.id === x && fits(W(c, y), t);
      })) : null;
      if (belt) { s += 1; why.push(`The ${belt.name} on the line`); }
      out.push(idea(c, belt ? 'title' : 'feud', [solo(a), solo(b)], { titleId: belt ? belt.id : null, stip: stip.stip, score: s,
        weight: belt ? 9.5 : c.ple ? 8.5 : 6 + (stip.stip ? 1 : 0) + (tonight ? 1 : 0), why, events, feud: key }));
    }

    // moving it on another way: someone who stands with the other one, or a tag match with backup on both sides
    const alt = justMet ? `They met one on one ${ago(c, lastDirect.wk)} — the feud moves on another way`
      : hold ? `Building to ${hold.ev.name} without giving the singles match away`
        : twoInARow ? 'Two singles matches in a row — something different this time'
          : rut ? `${SL.FORMAT_LABEL[rut].replace(/^./, x => x.toUpperCase())} twice running — something different this time` : '';
    const altBonus = justMet || hold ? 1.5 : twoInARow || rut ? 1 : 0;
    const ruts = f => (rut === f ? -2 : 0);
    const standing = (who, foe) => SL.drawnIn(c.st, c.d, l, who, foe)
      .filter(p => c.free.has(p.id) && sameDivision(c, foe, p.id) && !partnered(c, foe, p.id) && !bondOf(c, foe, p.id));
    [[a, b], [b, a]].forEach(([x, y]) => {
      if (!c.free.has(x)) return;
      standing(y, x).slice(0, 2).forEach(p => {
        const friend = p.how === 'drawn in' && lvl(c, 'friends', y, p.id);
        out.push(idea(c, friend ? 'defend' : 'build', [solo(x), solo(p.id)], { score: 0.8 + 0.45 * l.priority * p.weight + altBonus + ruts('proxy'), weight: 5,
          why: [friend ? `${nm(c, p.id)} stands up for a friend: ${nm(c, y)}’s feud with ${nm(c, x)}`
            : `${nm(c, x)} against ${nm(c, p.id)}, who stands with ${nm(c, y)}`, `Connection: ${p.path}`, lead, upset, alt || chapter], events, feud: key }));
      });
    });
    if (c.free.has(a) && c.free.has(b) && sameDivision(c, a, b)) {
      const [pa] = standing(a, b).filter(p => p.id !== b), [pb] = standing(b, a).filter(p => p.id !== a && (!pa || p.id !== pa.id));
      if (pa && pb && sameDivision(c, a, b, pa.id, pb.id)) {
        const sa = pairSide(c, a, pa.id), sb = pairSide(c, b, pb.id);
        const tstip = stipFor(c, 'tag', l.heat, `${key}:tag`, { tag: true });
        out.push(idea(c, 'build', [sa, sb], { stip: tstip.stip, score: 1.1 + 0.5 * l.priority + altBonus + ruts('tag') + (sa.team && sb.team ? 0.5 : 0), weight: 5.5,
          why: [`${nm(c, a)} and ${nm(c, b)} on opposite sides, each with backup`, `Connection: ${pa.path}`, `Connection: ${pb.path}`, lead, upset, alt, tstip.why],
          events, feud: key }));
      }
    }
  });
  return out;
}

// story events that make a particular kind of match: a save becomes a tag match, new allies
// take on a common enemy, a team in trouble has to hold it together
function hookIdeas(c) {
  const out = [];
  c.recent.forEach(({ event, incident: x, wk }) => {
    const age = c.wk - wk;
    if (age > 4) return;
    const fade = 0.5 ** (age / SL.RULES.halfLife);
    const at = when(c, { ev: event, wk });
    if (x.kind === 'save' && x.helped.length) {
      const [saver] = x.by, [foe] = x.on, [saved] = x.helped;
      if (![saver, foe, saved].every(id => c.free.has(id)) || !sameDivision(c, saver, foe, saved)) return;
      const l = SL.storyOf(c.lines, foe, saved) || SL.storyOf(c.lines, foe, saver);
      const back = l ? SL.drawnIn(c.st, c.d, l, foe, l.a === foe ? l.b : l.a)
        .find(p => c.free.has(p.id) && ![saver, saved].includes(p.id) && sameDivision(c, foe, p.id) && !bondOf(c, p.id, saved) && !bondOf(c, p.id, saver)) : null;
      const why = [`From the save: ${nm(c, saver)} saved ${nm(c, saved)} from ${nm(c, foe)} ${at} — now they team up`];
      if (back) {
        out.push(idea(c, 'hook', [pairSide(c, saver, saved), pairSide(c, foe, back.id)], { score: 2 + 2.5 * fade, weight: 6,
          why: [...why, `Connection: ${back.path}`], events: [x.id], feud: l ? l.key : null }));
      } else {
        out.push(idea(c, 'hook', [solo(foe), pairSide(c, saver, saved)], { score: 1.2 + 2 * fade, weight: 5.5,
          why: [...why, `${nm(c, foe)} has nobody to stand with — outnumbered`], events: [x.id], feud: l ? l.key : null }));
      }
    }
    if (x.kind === 'alliance') {
      const [p] = x.by, [q] = x.on;
      if (!c.free.has(p) || !c.free.has(q)) return;
      const foes = c.lines.filter(l => l.priority >= 1 && [p, q].some(y => y === l.a || y === l.b))
        .map(l => ({ l, foe: [p, q].includes(l.a) ? l.b : l.a, who: [p, q].includes(l.a) ? l.a : l.b }))
        .filter(f => ![p, q].includes(f.foe) && c.free.has(f.foe) && sameDivision(c, p, q, f.foe));
      const f = foes[0];
      if (!f) return;
      const back = SL.drawnIn(c.st, c.d, f.l, f.foe, f.who).find(z => c.free.has(z.id) && ![p, q].includes(z.id) && sameDivision(c, f.foe, z.id));
      if (!back) return;
      out.push(idea(c, 'hook', [pairSide(c, p, q), pairSide(c, f.foe, back.id)], { score: 1.8 + 2 * fade, weight: 5.5,
        why: [`New allies: ${nm(c, p)} and ${nm(c, q)} joined forces ${at}`, `Their common enemy: ${heatText(c, f.l)}`, `Connection: ${back.path}`],
        events: [x.id, ...storyEvents(f.l)], feud: f.l.key }));
    }
    if (x.kind === 'tension' && x.team) {
      const t = M.teamById(c.st, x.team);
      const ids = t && t.active ? freeOf(c, t, 2) : [];
      if (ids.length < 2) return;
      const opp = c.st.teams.filter(o => o.active && o.id !== t.id && !o.members.some(id => t.members.includes(id)) && freeOf(c, o, 2).length === 2
        && sameDivision(c, ...ids, ...freeOf(c, o, 2)))
        .sort((u, v) => (c.teamRank.get(u.id) || { rank: 99 }).rank - (c.teamRank.get(v.id) || { rank: 99 }).rank || u.name.localeCompare(v.name))[0];
      if (!opp) return;
      out.push(idea(c, 'hook', [{ team: t.id, wrestlers: ids }, { team: opp.id, wrestlers: freeOf(c, opp, 2) }], { score: 1.4 + 1.5 * fade, weight: 5,
        why: [`${t.name} must hold it together: ${nm(c, x.by[0])} and ${nm(c, (x.on[0] || x.by[1]))} clashed ${at}`, `Against ${opp.name}`], events: [x.id] }));
    }
  });
  return out;
}

// ---------------------------------------------------------------- the rare surprise
//
// Now and then - a seeded draw per card - one pairing nobody would predict:
// two with nothing between them and no meeting lately, but a hook that makes
// sense of it. At most one a card.

const SURPRISE = { quiet: 0.15, normal: 0.3, wild: 0.5 };
function surpriseIdeas(c) {
  if (!c.surprise) return [];
  const out = [];
  const ids = [...c.free].sort();
  ids.forEach((a, i) => ids.slice(i + 1).forEach(b => {
    if (!sameDivision(c, a, b) || partnered(c, a, b) || related(c, a, b) || meetings(c, a, b, 12).length) return;
    const hook = surpriseHook(c, a, b);
    if (hook) out.push(idea(c, 'surprise', [solo(a), solo(b)], { score: 3.2 + hook.weight, weight: 4.5, why: [`A surprise pairing — ${hook.text}`], events: hook.events }));
  }));
  return out;
}
const related = (c, a, b) => ['grudge', 'rivals', 'allies', 'friends', 'former-partners'].some(k => lvl(c, k, a, b) || lvl(c, k, b, a));
function surpriseHook(c, a, b) {
  const [A, B] = [nm(c, a), nm(c, b)];
  // a common enemy: both at war with the same third
  const foesOf = x => c.lines.filter(l => l.priority >= 1.5 && (l.a === x || l.b === x)).map(l => ({ l, foe: l.a === x ? l.b : l.a }));
  const common = foesOf(a).find(fa => foesOf(b).some(fb => fb.foe === fa.foe));
  if (common) return { weight: 0.6, text: `${A} and ${B} are both at war with ${nm(c, common.foe)}: whoever wins goes after them first`, events: storyEvents(common.l) };
  // both beat the same champion lately
  const beaten = x => (c.hist.get(x) || []).filter(e => c.wk - e.wk <= 4 && e.res === 'W')
    .flatMap(e => e.m.sides.filter((_, i) => i !== e.side).flatMap(sd => sd.wrestlers)).filter(id => held(c, id).length);
  const champ = beaten(a).find(id => beaten(b).includes(id));
  if (champ) return { weight: 0.5, text: `both have beaten ${nm(c, champ)}, the ${held(c, champ)[0].name} holder, lately: who’s next in line?`, events: [] };
  // two on a hot run who've never crossed paths
  const hot = x => ['hot', 'rising'].includes(mood(c, x).label);
  if (hot(a) && hot(b)) return { weight: 0.3, text: `two of the hottest on the show (${mood(c, a).form.slice(-3)} and ${mood(c, b).form.slice(-3)}) who haven’t crossed paths`, events: [] };
  return null;
}

// ---------------------------------------------------------------- tag teams and factions

function teamIdeas(c) {
  const out = [];
  const teams = c.st.teams.filter(t => t.active && freeOf(c, t, 9).length >= 2)
    .map(t => ({ t, ids: freeOf(c, t, 9) })).filter(x => genderOf(c, x.ids) !== 'mixed');
  const teamHeat = (x, y) => Math.max(0, ...x.t.members.flatMap(p => y.t.members.map(q => heatOf(c, p, q))));
  const between = (kind, x, y) => { const r = c.d.teams.get(RL.teamRelKey(kind, x, y)); return r && r.active ? r : null; };
  teams.forEach((x, i) => teams.slice(i + 1).forEach(y => {
    if (x.t.members.some(id => y.t.members.includes(id)) || genderOf(c, x.ids) !== genderOf(c, y.ids)) return;
    const heat = teamHeat(x, y);
    const [rx, ry] = [c.teamRank.get(x.t.id), c.teamRank.get(y.t.id)];
    const why = [];
    let s = 1;
    // the teams' own relationship says it best; heat between members says the rest
    const own = [between('grudge', x.t.id, y.t.id), between('grudge', y.t.id, x.t.id), between('rivals', x.t.id, y.t.id)].filter(Boolean)
      .sort((u, v) => v.level - u.level)[0];
    if (heat) { s += heat; why.push(own ? `${RL.teamRelText(c.st, own)} (heat ${own.level})` : `${x.t.name} and ${y.t.name} are at odds (heat ${heat} between them)`); }
    const allied = between('allies', x.t.id, y.t.id);
    if (allied) { s -= 1 + allied.level; why.push(`${RL.teamRelText(c.st, allied)} (strength ${allied.level}) — a friendly contest at most`); }
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
  [...c.free].forEach(id => (c.hist.get(id) || []).filter(x => c.wk - x.wk <= 2 && x.res === 'W'
    && (isSingles(x.m) || (x.m.fall && x.m.fall.by === id && x.m.fall.on))).forEach(x => {
    const tag = !isSingles(x.m);
    const loser = tag ? x.m.fall.on : x.m.sides[1 - x.side].wrestlers[0];
    const [rw, rl] = [c.rank.get(id), c.rank.get(loser)];
    const champ = held(c, loser);
    // nobody saw it coming: well down the standings, over a champion, or on a much worse run
    const upset = (rw && rl && rw.rank >= rl.rank + 3) || (!held(c, id).length && champ.length) || formGap(c, loser, id, x) >= 2;
    if (!upset || seen.has(`${id}>${loser}`)) return;
    seen.add(`${id}>${loser}`);
    const how = `${nm(c, id)} ${tag ? 'pinned' : 'upset'} ${nm(c, loser)} ${tag ? 'in a tag match ' : ''}${ago(c, x.wk)}${rw && rl && rw.rank > rl.rank ? ` (#${rw.rank} over #${rl.rank})` : champ.length ? `, the ${champ[0].name} holder` : ''}`;
    // a rematch - unless they've met again since, or they're a storyline (which carries the upset itself, and paces it)
    const since = meetings(c, id, loser).some(e => M.compareStamps(c.st, e.ev.at, x.ev.at) > 0);
    if (c.free.has(loser) && !since && !SL.storyOf(c.lines, id, loser)) {
      const proud = (W(c, loser) || { traits: [] }).traits.some(tr => tr === 'proud' || tr === 'hot-headed');
      out.push(idea(c, 'rematch', [solo(id), solo(loser)], { score: 2.2 + (proud ? 0.5 : 0) + (tag ? 0.5 : 0), weight: 5,
        why: [tag ? `Unfinished: ${how} — ${nm(c, loser)} wants ${nm(c, id)} one on one` : `Rematch: ${how} — nobody saw it coming`,
          proud ? `${nm(c, loser)} won’t let it go` : ''] }));
    }
    const g = (W(c, id) || {}).gender;
    [...c.free].filter(o => o !== id && o !== loser && (W(c, o) || {}).gender === g && (c.rank.get(o) || { rank: 99 }).rank <= 3)
      .slice(0, 2).forEach(o => {
        out.push(idea(c, 'step', [solo(id), solo(o)], { score: 1.8 + ((rl && rl.rank <= 3) || champ.length ? 0.7 : 0), weight: 4.5,
          why: [`A step up after an upset: ${how}`, `${nm(c, o)} is ${rankLine(c, o)}`] }));
      });
  }));
  return out;
}
// how much better the loser's run was than the winner's going into a match
function formGap(c, loser, winner, x) {
  const form = id => (c.hist.get(id) || []).filter(e => e.m !== x.m && e.wk <= x.wk && M.compareStamps(c.st, e.ev.at, x.ev.at) < 0).slice(-6)
    .reduce((n, e) => n + (e.res === 'W' ? 1 : e.res === 'L' ? -1 : 0), 0);
  return form(loser) - form(winner);
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
  const ideas = [...titleIdeas(c), ...storyIdeas(c), ...hookIdeas(c), ...surpriseIdeas(c), ...teamIdeas(c), ...upsetIdeas(c), ...chanceIdeas(c), ...turnIdeas(c),
    ...arrivalIdeas(c), ...freshIdeas(c)];
  // one idea per line-up and title: the best-scoring reason for it, with the others' reasons after its own
  const best = new Map();
  ideas.forEach(x => {
    const b = best.get(x.key);
    if (!b) { best.set(x.key, x); return; }
    // the story behind a line-up outranks a fresh matchup that happens to be the same people
    const [top, other] = (x.kind === 'fresh') !== (b.kind === 'fresh') ? (x.kind === 'fresh' ? [b, x] : [x, b]) : x.score > b.score ? [x, b] : [b, x];
    const leads = y => y.leads || [y.why[0]];
    best.set(x.key, other.kind === 'fresh' ? top
      : { ...top, leads: [...new Set([...leads(top), ...leads(other)])], why: [...new Set([...top.why, ...leads(other)])],
        events: [...new Set([...top.events, ...other.events])], feud: top.feud || other.feud });
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
  const count = { type: {}, gender: {}, feud: {}, titles: new Set(), contenders: new Set() };
  const note = x => {
    count.type[x.type] = (count.type[x.type] || 0) + 1;
    count.gender[x.gender] = (count.gender[x.gender] || 0) + 1;
    if (x.feud) count.feud[x.feud] = (count.feud[x.feud] || 0) + 1;
    if (x.titleId) count.titles.add(x.titleId);
    if (x.contender) count.contenders.add(x.contender);
  };
  counted.forEach(m => note({ type: typeOf(m), gender: genderOf(c, inMatch(m)), titleId: m.titleId, contender: m.contender, feud: null }));
  const cap = c.ple ? Infinity : c.settings.titles;
  const used = new Set();
  const picked = [];
  const rate = x => {
    if (picked.includes(x) || x.people.some(id => used.has(id) || !c.free.has(id)) || !types[x.type]) return null;
    if (x.titleId && (count.titles.has(x.titleId) || count.titles.size >= cap || count.contenders.has(x.titleId))) return null;
    // one card never has both a title's match and a #1 contender's match for it
    if (x.contender && (count.titles.has(x.contender) || count.contenders.has(x.contender))) return null;
    if (x.feud && (count.feud[x.feud] || 0) >= RULES.sameFeud) return null;
    if (x.kind === 'surprise' && picked.some(y => y.kind === 'surprise')) return null;
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
  return { sides: x.sides, titleId: x.titleId, contender: x.contender || null, stip: x.stip, notes: x.notes,
    auto: { kind: x.kind, key: x.key, why: x.why.slice(0, 5), events: x.events.slice(0, 12) } };
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
  const known = { seen: c.seen, played: playedCount(st) };
  if (slots <= 0) return { size: c.size, slots: 0, matches: [], ...known, short: `The card already holds ${plural(ev.matches.length + keep.length, 'match', 'matches')} of ${c.size}.` };
  const picked = runningOrder(assemble(c, allIdeas(c), slots, [...ev.matches, ...keep]));
  const away = c.roster.length - c.avail.length;
  const short = picked.length >= slots ? null
    : !picked.length ? `Nothing fits: ${c.free.size ? `only ${plural(c.free.size, 'wrestler')}` : 'nobody'} available on ${where}${away ? ` (${away} injured, away or out)` : ''}.`
      : `Only ${plural(picked.length, 'match', 'matches')} ${picked.length === 1 ? 'fits' : 'fit'} with ${plural(c.free.size, 'wrestler')} available on ${where}${away ? ` (${away} injured, away or out)` : ''}.`;
  return { size: c.size, slots, matches: picked, short, ...known };
}
const playedCount = st => st.events.reduce((n, e) => n + e.matches.filter(m => m.status === 'played').length, 0);

/**
 * The whole draft drawn again, keeping what the owner changed or added:
 * a list for model.setDraft, with kept matches where they were and new ones
 * in the gaps. { list, nonce, short }.
 */
export function redraft(st, eventId) {
  const ev = M.eventById(st, eventId);
  const d = ev && ev.draft;
  if (!d) return { list: [], nonce: 0, short: null, seen: null, played: null };
  const keep = d.matches.filter(x => !x.auto || x.auto.edited);
  const nonce = d.nonce + 1;
  const res = draftCard(st, eventId, { nonce, keep });
  const fresh = [...res.matches];
  const list = d.matches.map(x => (keep.includes(x) ? { keep: x.id } : fresh.length ? toSpec(fresh.shift()) : null)).filter(Boolean);
  fresh.forEach(x => list.push(toSpec(x)));
  return { list, nonce, short: res.short, seen: res.seen, played: res.played };
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
 * without its champion; a story event it followed that's been undone or
 * edited since. Never blocks booking. Map of draft match id -> [text].
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
    const ct = dm.contender && M.titleById(st, dm.contender);
    const cr = ct && M.currentReign(st, ct.id);
    if (ct && !ct.active) notes.push(`The ${ct.name} is retired`);
    if (cr && dm.sides.some(sd => (cr.holder.type === 'team' ? sd.team === cr.holder.id : sd.wrestlers.includes(cr.holder.id)))) {
      notes.push(`${M.holderName(st, cr.holder)} ${cr.holder.type === 'team' ? 'hold' : 'holds'} the ${ct.name} now — a #1 contender’s match is for the challengers`);
    }
    const nc = ct && M.numberOneContender(st, ct.id);
    if (nc) notes.push(`${M.holderName(st, nc.holder)} ${nc.holder.type === 'team' ? 'are' : 'is'} already #1 contender for the ${ct.name}`);
    const story = dm.auto ? storyState(st, dm.auto.events) : { gone: 0, edited: 0 };
    if (story.gone) notes.push(`The story event it followed has been undone`);
    else if (story.edited) notes.push(`The story event it followed has been edited since`);
    if (notes.length) out.set(dm.id, [...new Set(notes)]);
  });
  return out;
}
// of some story event ids: how many are gone (undone), and how many were edited by the owner
function storyState(st, ids) {
  const all = new Map(M.allIncidents(st).map(x => [x.incident.id, x.incident]));
  return { gone: ids.filter(id => !all.has(id)).length, edited: ids.filter(id => all.has(id) && all.get(id).edited).length };
}

/**
 * What has happened since a draft was drawn that it didn't know about: story
 * events around the show's roster, and how many results have come in.
 * { incidents: [{ event, incident }], results } - empty when nothing, or when
 * the draft doesn't know what it saw (one drawn before version 11).
 */
export function sinceDraft(st, ev) {
  const d = ev && ev.draft;
  if (!d || !Array.isArray(d.seen)) return { incidents: [], results: 0 };
  const c = context(st, ev, {});
  const seen = new Set(d.seen);
  const onRoster = new Set(c.roster.map(w => w.id));
  const incidents = c.recent.filter(x => !seen.has(x.incident.id) && [...x.incident.by, ...x.incident.on, ...x.incident.helped].some(id => onRoster.has(id)));
  return { incidents, results: d.played == null ? 0 : Math.max(0, playedCount(st) - d.played) };
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
