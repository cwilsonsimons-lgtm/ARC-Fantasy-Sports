// Universe — storylines: the feuds on record, worked out rather than stored.
//
// A storyline is two wrestlers at odds: a grudge or a rivalry between them, or
// something hostile the story director (or the owner) recorded - an attack, a
// betrayal, a brawl, a confrontation, a title challenge, a walk-out. Its beats
// are everything that's happened between them, in order: those incidents, and
// the matches that advanced it - one on one, on opposite sides of a tag or
// multi-person match, or through someone standing with the other one (a
// proxy). Nothing is stored: it's replayed from the record like
// relationships, so an undone story event or a corrected result changes the
// storyline too.
//
// What the auto booker reads from it:
//   chapters   how often the feud has advanced in a match, and in which formats
//   priority   how pressing it is now: its heat, plus every beat, each fading
//              by half every RULES.halfLife weeks - so a betrayal still counts
//              weeks later, and last night's attack counts most
//   stage      spark (nothing in the ring yet), building, peak (due a
//              blow-off), settled (a stipulation match won, or a truce, lately)
//   upset      the last chapter went to the one nobody expected
//   drawn in   who has taken a side, and why: a save, an interference, a tag
//              match on one side, a grudge of their own. Friends and partners
//              of one of them aren't enemies of the other by default - a tag
//              partner stands with them, and a friend only gets drawn in once
//              the feud is at its hottest. Someone close to both is torn, and
//              stays out of it.
import * as M from './model.js';
import * as RL from './relations.js';
import { history, weekNo } from './director.js';
import { incidentText } from './ui.js';

export const RULES = {
  window: 10,         // weeks of beats a storyline looks back over
  halfLife: 3,        // weeks for a beat's weight to halve
  settleWeeks: 3,     // a settled feud stays settled this long, unless something new happens
  peakChapters: 3,    // chapters before a blow-off is due
  hot: 4,             // a priority this high draws friends in
  active: 0.8,        // a priority below this, with no heat, is over
};
// how much each hostile beat adds to a storyline
export const WEIGHT = {
  betrayal: 5, breakup: 4, attack: 3, brawl: 3, interference: 2.5, challenge: 2.5, demand: 2, confrontation: 2, save: 2,
  tension: 1.5, truce: -3,
};
const pairKey = (a, b) => (a < b ? `${a}+${b}` : `${b}+${a}`);
const decay = age => 0.5 ** (Math.max(0, age) / RULES.halfLife);
const nm = (st, id) => (M.wrestlerById(st, id) || { name: '?' }).name;
const inMatch = m => m.sides.flatMap(sd => sd.wrestlers);
const isSingles = m => m.sides.length === 2 && m.sides.every(sd => sd.wrestlers.length === 1);
const formatOf = (m, i, j) => (isSingles(m) ? 'singles' : m.sides.length === 2 && m.sides[i].wrestlers.length > 1 && m.sides[j].wrestlers.length > 1 ? 'tag' : 'multi');
export const FORMAT_LABEL = { singles: 'one on one', tag: 'a tag match', multi: 'a multi-person match', proxy: 'through an ally' };

// the pairs each incident puts at odds - [x, y, kind] - and who it drew to whose side
function hostilePairs(inc) {
  const out = [];
  const cross = (xs, ys, kind) => xs.forEach(x => ys.forEach(y => { if (x !== y) out.push([x, y, kind]); }));
  if (['attack', 'betrayal', 'brawl', 'confrontation', 'challenge', 'demand', 'tension', 'breakup', 'interference', 'save', 'truce'].includes(inc.kind)) {
    cross(inc.by, inc.on, inc.kind);
  }
  return out;
}

/**
 * Every storyline as of a moment (`at` a stamp; null: now), most pressing
 * first. Each: { key, a, b, heat, beats, chapters, formats, direct, last,
 * started, priority, stage, settled, upset, hook, people }.
 */
export function storylines(st, { at = null, d = RL.relationships(st), hist = null } = {}) {
  const now = at ? weekNo(st, at) : weekNo(st, { season: M.activeSeason(st).id, week: M.activeSeason(st).week });
  const h = hist || history(st, at);
  const before = e => !at || M.compareStamps(st, e.at, at) <= 0;
  const lines = new Map();
  const line = (a, b) => {
    const key = pairKey(a, b);
    if (!lines.has(key)) {
      const [x, y] = a < b ? [a, b] : [b, a];
      lines.set(key, { key, a: x, b: y, beats: [], people: { [x]: new Map(), [y]: new Map() } });
    }
    return lines.get(key);
  };
  const lvl = (kind, a, b) => { const r = d.rels.get(RL.relKey(kind, a, b)); return r && r.active ? r.level || 1 : 0; };
  const heatOf = (a, b) => Math.max(lvl('grudge', a, b), lvl('grudge', b, a), lvl('rivals', a, b));

  // grudges and rivalries on record start a storyline, whatever else has happened
  [...d.rels.values()].filter(r => r.active && (r.kind === 'grudge' || r.kind === 'rivals')).forEach(r => line(r.a, r.b));
  // story events: hostile ones are beats; saves, interferences and alliances draw people in
  M.allIncidents(st).forEach(({ event, incident: inc }) => {
    if (!before(event)) return;
    const wk = weekNo(st, event.at);
    if (now - wk >= RULES.window || wk > now) return;
    const where = `${event.name}${inc.phase === 'pre' ? ', before the show' : inc.phase === 'post' ? ', after the show' : ''}`;
    hostilePairs(inc).forEach(([x, y, kind]) => {
      line(x, y).beats.push({ wk, ev: event, order: inc.phase === 'pre' ? 0 : 2, kind, incident: inc.id, by: x, on: y, text: `${incidentText(st, inc)} at ${where}`, weight: WEIGHT[kind] || 1 });
    });
    // whoever was helped, and whoever helped them, are on one side against the one it was against
    if ((inc.kind === 'save' || inc.kind === 'interference') && inc.helped.length) {
      inc.on.forEach(foe => inc.helped.forEach(friend => inc.by.forEach(helper => {
        if (helper === foe || friend === foe) return;
        const l = line(friend, foe);
        l.beats.push({ wk, ev: event, order: inc.phase === 'pre' ? 0 : 2, kind: inc.kind === 'save' ? 'saved' : 'helped', incident: inc.id, by: foe, on: friend,
          text: `${incidentText(st, inc)} at ${where}`, weight: 1 });
        side(l, friend).set(helper, { id: helper, weight: 1.5, wk, incident: inc.id,
          why: `${inc.kind === 'save' ? 'made the save for' : 'interfered for'} ${nm(st, friend)} against ${nm(st, foe)} at ${event.name}` });
      })));
    }
  });
  // matches between them: one on one, or on opposite sides of something bigger
  lines.forEach(l => {
    (h.get(l.a) || []).forEach(x => {
      if (now - x.wk >= RULES.window) return;
      const j = x.m.sides.findIndex((sd, i) => i !== x.side && sd.wrestlers.includes(l.b));
      if (j < 0) return;
      const format = formatOf(x.m, x.side, j);
      const winner = x.m.outcome === 'win' ? (x.m.winner === x.side ? l.a : x.m.winner === j ? l.b : null) : null;
      l.beats.push({ wk: x.wk, ev: x.ev, order: 1, kind: 'match', match: x.m.id, format, winner, outcome: x.m.outcome, stip: x.m.stip || '',
        titleId: x.m.titleId || null, upset: winner ? unexpected(h, winner, winner === l.a ? l.b : l.a, x) : false,
        text: `${matchText(st, x.m, winner)} at ${x.ev.name}`, weight: 0.5 });
      // partners who stood with one of them against the other are drawn in
      [[x.side, l.a, l.b], [j, l.b, l.a]].forEach(([si, who, foe]) => x.m.sides[si].wrestlers.filter(p => p !== who).forEach(p => {
        const cur = side(l, who).get(p);
        if (!cur || cur.weight < 1) side(l, who).set(p, { id: p, weight: 1, wk: x.wk, why: `teamed with ${nm(st, who)} against ${nm(st, foe)} at ${x.ev.name}` });
      }));
    });
  });
  // proxies: one of them against someone standing with the other, while it's going on
  lines.forEach(l => {
    [[l.a, l.b], [l.b, l.a]].forEach(([x, y]) => (h.get(x) || []).forEach(e => {
      if (now - e.wk >= RULES.window || inMatch(e.m).includes(y)) return;
      const live = l.beats.some(b => b.kind !== 'match' && e.wk - b.wk >= 0 && e.wk - b.wk <= 4) || heatOf(x, y);
      if (!live) return;
      const foes = e.m.sides.filter((_, i) => i !== e.side).flatMap(sd => sd.wrestlers);
      const ally = foes.find(z => stands(st, d, y, z));
      if (!ally) return;
      l.beats.push({ wk: e.wk, ev: e.ev, order: 1, kind: 'match', match: e.m.id, format: 'proxy', via: ally,
        winner: e.m.outcome === 'win' ? (e.m.winner === e.side ? x : ally) : null, outcome: e.m.outcome, stip: e.m.stip || '', upset: false,
        text: `${matchText(st, e.m, null)} at ${e.ev.name} — ${nm(st, ally)} standing in for ${nm(st, y)}`, weight: 0.3 });
    }));
  });

  const out = [];
  lines.forEach(l => {
    l.beats.sort((p, q) => p.wk - q.wk || M.compareStamps(st, p.ev.at, q.ev.at) || p.order - q.order);
    // one beat per incident per pair (an incident can name several people)
    const seen = new Set();
    l.beats = l.beats.filter(b => { const k = `${b.kind}:${b.incident || b.match}:${b.via || ''}`; if (seen.has(k)) return false; seen.add(k); return true; });
    l.heat = heatOf(l.a, l.b);
    l.mutual = !!(lvl('grudge', l.a, l.b) && lvl('grudge', l.b, l.a));
    const chapters = l.beats.filter(b => b.kind === 'match');
    l.chapters = chapters.length;
    l.direct = chapters.filter(b => b.format !== 'proxy').length;
    l.formats = chapters.map(b => b.format);
    l.last = l.beats.length ? l.beats[l.beats.length - 1].wk : null;
    l.started = l.beats.length ? l.beats[0].wk : null;
    // settled: a stipulation match between them with a winner, or a truce, and nothing hostile since
    const settle = [...l.beats].reverse().find(b => b.kind === 'truce' || (b.kind === 'match' && b.format !== 'proxy' && b.stip && b.winner));
    const after = settle ? l.beats.filter(b => b.wk > settle.wk && b.kind !== 'match' && b.kind !== 'truce' && (WEIGHT[b.kind] || 0) > 0) : [];
    l.settled = settle && !after.length && now - settle.wk < RULES.settleWeeks ? { wk: settle.wk, text: settle.text } : null;
    const lastMatch = chapters.filter(b => b.format !== 'proxy').pop();
    l.upset = lastMatch && lastMatch.upset && now - lastMatch.wk <= 2 ? lastMatch : null;
    l.priority = 0.8 * l.heat + l.beats.reduce((n, b) => n + b.weight * decay(now - b.wk), 0) + (l.upset ? 1.5 : 0) - (l.settled ? 2 : 0);
    // the beat that drives it now: the heaviest story event, as it has faded (the latest, when level)
    l.hook = l.beats.filter(b => b.kind !== 'match' && b.weight > 0)
      .reduce((best, b) => (!best || b.weight * decay(now - b.wk) >= best.weight * decay(now - best.wk) ? b : best), null);
    l.stage = l.settled ? 'settled' : !l.chapters ? 'spark' : l.direct >= RULES.peakChapters || (l.heat >= 3 && l.direct >= 1) || l.priority >= 7 ? 'peak' : 'building';
    l.people = Object.fromEntries(Object.entries(l.people).map(([k, v]) => [k, [...v.values()]]));
    if (l.priority >= RULES.active || l.heat) out.push(l);
  });
  return out.sort((p, q) => q.priority - p.priority || p.key.localeCompare(q.key));
}
function side(l, who) { return l.people[who]; }

// the result, as the record has it: "A def. B", "A vs B — draw"
function matchText(st, m, winner) {
  const sides = m.sides.map(sd => (sd.team && M.teamById(st, sd.team) ? M.teamById(st, sd.team).name : sd.wrestlers.map(id => nm(st, id)).join(' & ')));
  if (m.outcome === 'win') return `${sides[m.winner]} beat ${sides.filter((_, i) => i !== m.winner).join(' and ')}`;
  return `${sides.join(' vs ')} — ${m.outcome === 'draw' ? 'a draw' : 'no contest'}`;
}

// nobody expected it: the winner came in with a clearly worse run than the loser
function unexpected(h, winner, loser, x) {
  const form = id => {
    const prior = (h.get(id) || []).filter(e => e.m !== x.m && (e.wk < x.wk || (e.wk === x.wk && e.ev !== x.ev && e.ev.at.day < x.ev.at.day))).slice(-6);
    return prior.reduce((n, e) => n + (e.res === 'W' ? 1 : e.res === 'L' ? -1 : 0), 0);
  };
  return form(loser) - form(winner) >= 2;
}

// does z stand with y? a tag partner, a friend or an ally - and not close to the other side too (checked by callers)
function stands(st, d, y, z) {
  const lvl = kind => { const r = d.rels.get(RL.relKey(kind, y, z)); return r && r.active ? r.level || 1 : 0; };
  return st.teams.some(t => t.active && t.members.includes(y) && t.members.includes(z)) || lvl('friends') || lvl('allies');
}

/** The storyline between two wrestlers, if there is one. */
export const storyOf = (lines, a, b) => lines.find(l => l.key === pairKey(a, b)) || null;

/**
 * Who could stand with `who` against `foe` in a storyline, and how strongly:
 * [{ id, weight, how, why, path }]. Drawn in (a save, an interference, a tag
 * match on their side, a grudge of their own against `foe`) counts fully; a
 * tag partner stands with them; a friend or ally only once the feud is at its
 * hottest. Anyone close to `foe` as well is torn, and left out.
 */
export function drawnIn(st, d, l, who, foe) {
  const lvl = (kind, a, b) => { const r = d.rels.get(RL.relKey(kind, a, b)); return r && r.active ? r.level || 1 : 0; };
  const close = (a, b) => st.teams.some(t => t.active && t.members.includes(a) && t.members.includes(b)) || lvl('friends', a, b) || lvl('allies', a, b);
  const out = new Map();
  const add = (id, weight, how, why) => {
    if (id === who || id === foe || close(id, foe)) return;
    const cur = out.get(id);
    if (!cur || cur.weight < weight) out.set(id, { id, weight, how, why });
  };
  (l.people[who] || []).forEach(p => add(p.id, p.weight, 'drawn in', p.why));
  st.wrestlers.forEach(w => {
    if (w.id === who || w.id === foe) return;
    const grudge = lvl('grudge', w.id, foe);
    const partner = st.teams.some(t => t.active && t.members.includes(who) && t.members.includes(w.id));
    const friend = lvl('friends', who, w.id), ally = lvl('allies', who, w.id);
    if (!partner && !friend && !ally) return;
    const bond = partner ? 'tag partner' : friend ? 'friend' : 'ally';
    if (grudge) add(w.id, 1.2 + 0.2 * grudge, 'drawn in', `${nm(st, who)}’s ${bond}, with a grudge of their own against ${nm(st, foe)}`);
    else if (partner) add(w.id, 0.8, bond, `${nm(st, who)}’s tag partner`);
    else if (l.priority >= RULES.hot) add(w.id, 0.5, bond, `${nm(st, who)}’s ${bond} — the feud is at its hottest`);
  });
  return [...out.values()].sort((p, q) => q.weight - p.weight || p.id.localeCompare(q.id))
    .map(p => ({ ...p, path: `${nm(st, foe)} → ${nm(st, who)} (${relWord(l, foe, who)}) → ${nm(st, p.id)} (${p.why})` }));
}
// the link between two principals, in a word or two
function relWord(l, a) {
  const g = l.beats.filter(b => b.kind !== 'match').pop();
  return l.heat ? (l.mutual ? 'grudges both ways' : 'rival') : g ? g.kind : 'at odds';
}

/** What a storyline is, in a line: "Chapter 3 · heat 2 · last: …". */
export function storyText(st, l) {
  const chap = l.chapters ? `${l.chapters} chapter${l.chapters === 1 ? '' : 's'} (${[...new Set(l.formats)].map(f => FORMAT_LABEL[f]).join(', ')})` : 'not in the ring yet';
  const last = l.beats[l.beats.length - 1];
  return `${chap}${l.heat ? ` · heat ${l.heat}` : ''}${last ? ` · last: ${last.text}` : ''}`;
}
export const STAGE_LABEL = { spark: 'Spark', building: 'Building', peak: 'At its peak', settled: 'Settled' };
