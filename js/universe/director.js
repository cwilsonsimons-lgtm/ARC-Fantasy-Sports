// Universe — the story director: what else happens around each show.
//
// The owner watches the CPU play the matches and enters the results; the
// director fills in the rest of the story, as canon, with no approval step.
// Before a show (once it's the next one up) it can have wrestlers confront
// each other, demand a title shot, lay down an open challenge, join forces,
// argue with a partner, let a rivalry cool, or turn - and tag teams at odds
// face off. After the results it can have someone run in (a friend, partner
// or ally helping them win; a rival costing someone the match), a loser attack
// the winner (their partners joining in, and someone make the save), a
// partner turn traitor, a rivalry boil over, a team split, a rival shake
// hands, someone step up to a champion - a new #1 contender first of all - or
// an underdog's run get noticed. That happens straight after each match, as
// soon as its result is in, about that match; once the whole card is in (or
// its week is over) it looks once more at what wasn't about one match: bad
// blood between people in different matches, and a champion who didn't
// wrestle being called out.
//
// Everything comes from the record: personalities, relationships, goals,
// momentum, champions, teams, recent results and what has already happened.
// Each event keeps the reasons it happened. A seeded draw decides - the same
// save always makes the same story, and every run is logged with every
// possibility it weighed, its chance and its draw.
//
// Rules it keeps:
//   - it never touches a match, a title reign or a roster move: results come
//     from the game, titles change only on an entered result, and moves only
//     through the draft and relegation rules
//   - occasional: every chance starts small; the pace scales it; each show
//     and week has a limit; a show never gets two of a kind or one wrestler
//     twice; anyone in something lately is less likely to be in more
//   - varied: the same thing between the same people won't happen again for
//     RULES.repeatWeeks weeks; betrayals, breakups and turns are spaced apart
//   - earned: betrayals, breakups and turns need buildup - tension, grudges,
//     losing together, a record of attacks - except for the rare shock
//   - open: a title challenger is drawn from everyone eligible, and an
//     underdog's wins are noticed, so the bottom of the rankings can rise
import * as M from './model.js';
import * as RL from './relations.js';
import * as SD from './standings.js';

export const PACE = {
  quiet: { label: 'Quiet', mult: 0.5, pre: 1, post: 1, perWeek: 2, text: 'Now and then. Most shows pass with nothing off the card.' },
  normal: { label: 'Normal', mult: 1, pre: 1, post: 2, perWeek: 3, text: 'Something every show or two — rarely more than a couple of things at once.' },
  wild: { label: 'Wild', mult: 2, pre: 2, post: 3, perWeek: 6, text: 'Something most nights. Chaos, within limits — buildup still counts.' },
};
export const KIND = {
  attack: { label: 'Post-match attack', phase: 'post', base: 0.02 },
  interference: { label: 'Interference', phase: 'post', base: 0.02 },
  save: { label: 'Surprise save', phase: 'post', base: 0.35 },
  betrayal: { label: 'Betrayal', phase: 'post', base: 0.25, spacing: 3 },
  brawl: { label: 'Rivalry escalates', phase: 'post', base: 0.012 },
  tension: { label: 'Team tension', phase: 'both', base: 0.03 },
  breakup: { label: 'Team breakup', phase: 'post', base: 0.3, spacing: 4 },
  rise: { label: 'On the rise', phase: 'post', base: 0.2 },
  challenge: { label: 'Title challenge', phase: 'post', base: 0.03 },
  respect: { label: 'Rivalry cools', phase: 'post', base: 0.07 },
  turn: { label: 'Turn', phase: 'both', base: 0.3, spacing: 4 },
  confrontation: { label: 'Backstage confrontation', phase: 'pre', base: 0.03 },
  demand: { label: 'Title demand', phase: 'pre', base: 0.02 },
  'open-challenge': { label: 'Open challenge', phase: 'pre', base: 0.012 },
  alliance: { label: 'New alliance', phase: 'pre', base: 0.03 },
  cooling: { label: 'Rivalry cools', phase: 'pre', base: 0.04 },
};
export const RULES = {
  recentWeeks: 2, recentFactor: 0.45, repeatWeeks: 6, calmFactor: 0.6, maxChance: 0.85, window: 2,
  buildupWeeks: 12, betrayalBuildup: 5, breakupTension: 2, turnGapWeeks: 10, shockChance: 0.004, shockSpacing: 8,
  dormantWeeks: 6, streakMin: 3,
};

// ---------------------------------------------------------------- the draw

/** A number in [0, 1) from a string: the same string, the same number. */
export function draw(...parts) {
  const str = parts.join('|');
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// weeks counted across seasons, so "the last two weeks" works over a season break
export function weekNo(st, stamp) {
  let n = 0;
  for (const s of [...st.seasons].sort((a, b) => a.number - b.number)) {
    if (s.id === stamp.season) return n + stamp.week;
    n += s.status === 'active' ? s.week : s.ended.week;
  }
  return n + stamp.week;
}
const pct = x => `${Math.round(x * 100)}%`;
const ordinal = n => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
const sameSet = (a = [], b = []) => a.length === b.length && a.every(x => b.includes(x));
const holders = (st, h) => (h.type === 'team' ? (M.teamById(st, h.id) || { members: [] }).members : [h.id]);
const fits = (w, t) => t.division === 'open' || (t.division === 'men') === (w.gender === 'male');
const winnersOf = m => (m.outcome === 'win' ? m.sides[m.winner].wrestlers : []);

// ---------------------------------------------------------------- momentum and goals (also shown on profiles)

export function history(st, upTo) {
  const hist = new Map();
  st.events.filter(e => !upTo || M.compareStamps(st, e.at, upTo) <= 0).sort((a, b) => M.compareStamps(st, a.at, b.at))
    .forEach(e => e.matches.filter(m => m.status === 'played').forEach(m => m.sides.forEach((sd, i) => sd.wrestlers.forEach(id => {
      if (!hist.has(id)) hist.set(id, []);
      hist.get(id).push({ ev: e, m, side: i, res: M.resultFor(m, i), wk: weekNo(st, e.at) });
    }))));
  return hist;
}
const championOn = (st, wid, ev) => st.reigns.some(r => holders(st, r.holder).includes(wid)
  && M.compareStamps(st, r.start, ev.at) <= 0 && (!r.end || M.compareStamps(st, r.end, ev.at) >= 0));

/**
 * How someone's going: their last six results, with a bonus for beating a
 * champion and for a winning run. { score, label, form, reasons } - label is
 * hot, rising, steady or cold.
 */
export function momentumOf(st, wid, hist = history(st, null)) {
  const h = (hist.get(wid) || []).slice(-6);
  let score = 0;
  const reasons = [];
  h.forEach(x => {
    if (x.res === 'W') {
      score += 1;
      const beaten = x.m.sides.filter((_, i) => i !== x.side).flatMap(sd => sd.wrestlers).filter(id => championOn(st, id, x.ev) && !championOn(st, wid, x.ev));
      if (beaten.length) { score += 1; reasons.push(`beat ${(M.wrestlerById(st, beaten[0]) || { name: 'a champion' }).name}, a champion, at ${x.ev.name}`); }
    } else if (x.res === 'L') score -= 1;
  });
  let run = 0;
  for (let i = h.length - 1; i >= 0 && h[i].res === 'W'; i--) run++;
  if (run >= 3) { score += 1; reasons.unshift(`${run} straight wins`); }
  const label = score >= 4 ? 'hot' : score >= 2 ? 'rising' : score <= -3 ? 'cold' : 'steady';
  return { score, label, form: h.map(x => x.res).join(''), run, reasons };
}

/** What someone's after right now, worked out from the record - a sentence, or null. */
export function goalOf(st, wid, d = RL.relationships(st), hist = history(st, null)) {
  const w = M.wrestlerById(st, wid);
  if (!w) return null;
  const held = st.titles.filter(t => { const r = M.currentReign(st, t.id); return r && holders(st, r.holder).includes(wid); });
  if (held.length) return `Keep the ${held[0].name}`;
  const grudges = [...d.rels.values()].filter(r => r.active && r.kind === 'grudge' && r.a === wid).sort((a, b) => b.level - a.level);
  if (grudges[0] && grudges[0].level >= 2) return `Revenge on ${(M.wrestlerById(st, grudges[0].b) || { name: '?' }).name}`;
  const mo = momentumOf(st, wid, hist);
  const title = st.titles.find(t => t.active && t.kind === 'singles' && t.showId === w.showId && fits(w, t));
  if (title && (w.traits.includes('ambitious') || mo.label === 'hot' || mo.label === 'rising')) return `Win the ${title.name}`;
  const team = st.teams.find(t => t.active && t.members.includes(wid));
  if (team && !M.titlesHeldBy(st, { type: 'team', id: team.id }).length) return `Tag team gold with ${team.name}`;
  if (mo.label === 'cold') return 'Turn it around';
  return null;
}

// ---------------------------------------------------------------- what the director knows about a show

// `matchId`: straight after that match - only it, and the people in it, are "tonight"
function context(st, ev, phase, nonce, matchId = null) {
  const d = RL.relationships(st);
  const wk = weekNo(st, ev.at);
  const hist = history(st, ev.at);
  const focus = matchId ? ev.matches.find(m => m.id === matchId && m.status === 'played') || null : null;
  const tonight = focus ? [focus] : ev.matches.filter(m => m.status === 'played');
  const booked = ev.matches.filter(m => m.status === 'scheduled');
  const onCard = new Set((phase === 'post' ? tonight : booked).flatMap(m => m.sides.flatMap(sd => sd.wrestlers)));
  // who's around: the show's roster, or for an all-shows event everyone on its card
  const card = new Set(ev.matches.flatMap(m => m.sides.flatMap(sd => sd.wrestlers)));
  const around = ev.showId ? st.wrestlers.filter(w => w.showId === ev.showId || card.has(w.id)) : st.wrestlers.filter(w => card.has(w.id));
  const incidents = M.allIncidents(st).filter(x => M.compareStamps(st, x.event.at, ev.at) <= 0).map(x => ({ ...x, wk: weekNo(st, x.event.at) }));
  // what the director has done before: every event it picked, by kind and key (this part of this show aside)
  const same = r => r.event === ev.id && r.phase === phase && (r.match || null) === (matchId || null);
  const picks = st.story.rolls.filter(r => !r.undone && !same(r)).flatMap(r => {
    const e = M.eventById(st, r.event);
    return e ? r.considered.filter(k => k.picked).map(k => ({ ...k, wk: weekNo(st, e.at), ev: e, phase: r.phase })) : [];
  });
  // where they stand: the show's standings this season (for spotting an underdog)
  const season = M.seasonById(st, ev.at.season);
  const table = SD.standings(st, { showId: ev.showId || null, period: SD.periodOf(st, season.id) });
  const size = table.ranked.length + table.unranked.length;
  const rank = new Map(table.ranked.map(r => [r.id, r.rank]));
  return { st, ev, phase, nonce, focus, matchId, d, wk, hist, tonight, booked, onCard, around, incidents, picks, rank, size,
    seed: st.story.seed, pace: PACE[st.story.pace] };
}

const W = (c, id) => M.wrestlerById(c.st, id);
const nm = (c, id) => (W(c, id) || { name: '?' }).name;
const names = (c, ids) => ids.map(id => nm(c, id)).join(' & ');
const has = (c, id, trait) => (W(c, id) || { traits: [] }).traits.includes(trait);
const align = (c, id) => (W(c, id) || {}).alignment || null;
const rel = (c, kind, a, b) => { const r = c.d.rels.get(RL.relKey(kind, a, b)); return r && r.active ? r : null; };
const heat = (c, a, b) => (rel(c, 'grudge', a, b) || { level: 0 }).level;
function run(c, id) {
  const h = c.hist.get(id) || [];
  if (!h.length) return { res: null, n: 0 };
  const res = h[h.length - 1].res;
  let n = 0;
  for (let i = h.length - 1; i >= 0 && h[i].res === res; i--) n++;
  return { res, n };
}
function lossesTo(c, id, ws) {
  const h = (c.hist.get(id) || []).filter(x => x.m.sides.some((sd, i) => i !== x.side && sd.wrestlers.some(w => ws.includes(w))));
  let n = 0;
  for (let i = h.length - 1; i >= 0 && h[i].res === 'L'; i--) n++;
  return n;
}
// incidents between two people (either way) of some kinds, in the last `weeks`
const between = (c, a, b, kinds, weeks = RULES.buildupWeeks) => c.incidents.filter(x => kinds.includes(x.incident.kind) && c.wk - x.wk < weeks
  && ((x.incident.by.includes(a) && x.incident.on.includes(b)) || (x.incident.by.includes(b) && x.incident.on.includes(a)))).length;
const lastPickOf = (c, kind) => c.picks.filter(p => p.kind === kind).reduce((w, p) => Math.max(w, p.wk), -99);
const goal = (c, id) => goalOf(c.st, id, c.d, c.hist);
const teamOf = (c, a, b) => c.st.teams.find(t => t.active && t.members.includes(a) && t.members.includes(b)) || null;

// A possibility: its chance is base x every factor x the pace, and each
// factor carries the sentence that explains it.
function candidate(c, kind, key, people) {
  return { kind, key, people, factors: [], plan: null, basis: null, chance: 0, extra: null, prompt: null, shock: false };
}
const why = (cand, factor, text) => { cand.factors.push({ factor, text }); };
const driven = cand => cand.factors.some(f => f.factor > 1);
const outOfNowhere = (cand, factor = 0.3) => { if (!driven(cand)) why(cand, factor, 'Nothing much behind it — this comes out of nowhere'); };

// fresh and varied: nothing twice on one show, nothing repeated between the
// same people for a while, and less for anyone who's been in something lately
function freshness(c, cand) {
  const p = cand.plan.incidents[0];
  if (c.ev.incidents.some(x => x.kind === p.kind && sameSet(x.by, p.by) && sameSet(x.on, p.on))) return false;
  if (c.picks.some(k => k.key === cand.key && c.wk - k.wk < RULES.repeatWeeks)) return false;
  if (c.incidents.some(x => x.incident.kind === p.kind && sameSet(x.incident.by, p.by) && sameSet(x.incident.on, p.on)
    && c.wk - x.wk < RULES.repeatWeeks && x.event.id !== c.ev.id)) return false;
  const recent = new Set();
  c.incidents.filter(x => c.wk - x.wk < RULES.recentWeeks && x.incident.id !== cand.prompt)
    .forEach(x => [...x.incident.by, ...x.incident.on, ...x.incident.helped].forEach(id => { if (cand.people.includes(id)) recent.add(id); }));
  if (recent.size) {
    why(cand, RULES.recentFactor ** Math.min(2, recent.size),
      `Less likely: ${names(c, [...recent])} ${recent.size === 1 ? 'was' : 'were'} in something in the last ${RULES.recentWeeks} weeks`);
  }
  return true;
}
function finish(c, cand, base) {
  let x = base * c.pace.mult;
  cand.factors.forEach(f => { x *= f.factor; });
  cand.chance = Math.min(RULES.maxChance, x);
  return cand;
}
// a major kind (betrayal, breakup, turn) is spaced out across the whole universe
const spaced = (c, kind) => !KIND[kind].spacing || c.wk - lastPickOf(c, kind) >= KIND[kind].spacing;
const shockAllowed = c => c.wk - Math.max(-99, ...c.picks.filter(p => p.shock).map(p => p.wk)) >= RULES.shockSpacing;

// ================================================================ after the show

function attacks(c) {
  const out = [];
  c.tonight.forEach(m => {
    if (m.outcome !== 'win') return;
    const Ws = winnersOf(m);
    const reign = c.st.reigns.find(r => r.matchId === m.id);
    const best = [];
    m.sides.forEach((sd, i) => {
      if (i === m.winner) return;
      sd.wrestlers.forEach(l => {
        if (c.st.teams.some(t => t.active && t.members.includes(l) && Ws.some(w => t.members.includes(w)))) return;
        const cand = candidate(c, 'attack', `attack:${l}>${[...Ws].sort().join('+')}`, [l, ...Ws]);
        const L = nm(c, l), V = names(c, Ws);
        why(cand, 1, `${L} lost to ${V} at ${c.ev.name}`);
        if (has(c, l, 'hot-headed')) why(cand, 2.2, `${L} is hot-headed`);
        if (has(c, l, 'proud')) why(cand, 1.4, `${L} is proud, and hates to lose`);
        if (has(c, l, 'cowardly')) why(cand, 1.3, `${L} is cowardly — happy to strike once the bell has gone`);
        if (has(c, l, 'patient')) why(cand, 0.6, `Less likely: ${L} is patient`);
        if (has(c, l, 'respectful')) why(cand, 0.3, `Less likely: ${L} is respectful`);
        if (align(c, l) === 'heel') why(cand, 1.3, `${L} is a heel`);
        const h = Math.max(...Ws.map(w => heat(c, l, w)));
        if (h) why(cand, 1 + 0.7 * h, `${L} holds a grudge against ${V} (heat ${h})`);
        if (Ws.some(w => rel(c, 'rivals', l, w))) why(cand, 1.4, `${L} and ${V} are rivals`);
        if (reign) why(cand, 2.5, `${L} just lost the ${M.titleById(c.st, reign.titleId).name}`);
        else if (m.contender) why(cand, 1.8, `${L} just lost a #1 contender’s match for the ${(M.titleById(c.st, m.contender) || { name: 'title' }).name}`);
        const n = lossesTo(c, l, Ws);
        if (n >= 2) why(cand, 1 + 0.35 * n, `${L} has lost ${n} straight to ${V}`);
        if (Ws.some(w => between(c, l, w, ['confrontation'], 1))) why(cand, 1.5, `They'd already confronted each other before the show`);
        if ((goal(c, l) || '').startsWith('Revenge on') && Ws.some(w => goal(c, l) === `Revenge on ${nm(c, w)}`)) why(cand, 1.3, `${L} wants revenge`);
        outOfNowhere(cand);
        if (Ws.some(w => rel(c, 'friends', l, w))) why(cand, 0.15, `Less likely: ${L} and ${V} are friends`);
        else if (Ws.some(w => rel(c, 'allies', l, w))) why(cand, 0.4, `Less likely: ${L} and ${V} are allies`);
        // partners join in: whoever lost alongside them, or a teammate who'd stand with them
        const backup = backupFor(c, l, Ws, m);
        if (backup.length) {
          why(cand, has(c, l, 'cowardly') ? 1.4 : 1.15, `${names(c, backup.map(b => b.id))} ${backup.length > 1 ? 'join' : 'joins'} in — ${backup.map(b => b.why).join('; ')}`);
          cand.people.push(...backup.map(b => b.id));
        }
        cand.plan = { incidents: [{ kind: 'attack', by: [l, ...backup.map(b => b.id)], on: [...Ws], match: m.id }] };
        cand.basis = { match: m.id, winners: Ws };
        if (!freshness(c, cand)) return;
        cand.extra = saverFor(c, l, Ws, m.id);
        best.push(finish(c, cand, KIND.attack.base));
      });
    });
    const top = best.sort((a, b) => b.chance - a.chance)[0];
    if (top) out.push(top);
  });
  return out;
}

// who joins an attack: a partner who lost alongside them, or a teammate - loyal, or backing up a coward -
// never anyone close to the ones attacked, and never the respectful
function backupFor(c, attacker, victims, m) {
  const out = [];
  const lostWith = m.sides.find(sd => sd.wrestlers.includes(attacker)).wrestlers;
  const close = z => victims.some(v => rel(c, 'friends', z, v) || rel(c, 'allies', z, v) || teamOf(c, z, v));
  c.around.filter(z => z.status === 'active' && z.id !== attacker && !victims.includes(z.id)).forEach(z => {
    if (has(c, z.id, 'respectful') || close(z.id)) return;
    const team = teamOf(c, attacker, z.id);
    const ally = rel(c, 'allies', attacker, z.id);
    if (lostWith.includes(z.id)) {
      if (team || (ally && ally.level >= 2)) out.push({ id: z.id, why: `${z.name} lost alongside ${nm(c, attacker)}${team ? `, their partner in ${team.name}` : ''}` });
      return;
    }
    if (!team || m.sides.some(sd => sd.wrestlers.includes(z.id))) return;
    if (has(c, z.id, 'loyal')) out.push({ id: z.id, why: `${z.name} is loyal to ${nm(c, attacker)}, their partner in ${team.name}` });
    else if (has(c, attacker, 'cowardly')) out.push({ id: z.id, why: `${nm(c, attacker)} is cowardly and brings ${team.name} backup` });
    else if (team.members.length >= 3) out.push({ id: z.id, why: `${team.name} stick together` });
  });
  return out.slice(0, 2);
}

// someone not in the match gets involved: a friend, partner or ally helps them win, or a rival costs someone the match
function interferences(c) {
  const out = [];
  c.tonight.forEach(m => {
    if (m.outcome !== 'win') return;
    const Ws = winnersOf(m);
    const inMatch = new Set(m.sides.flatMap(sd => sd.wrestlers));
    const losers = m.sides.filter((_, i) => i !== m.winner).flatMap(sd => sd.wrestlers);
    const reign = c.st.reigns.find(r => r.matchId === m.id);
    const best = [];
    c.around.filter(z => z.status === 'active' && !inMatch.has(z.id)).forEach(z => {
      if (losers.some(y => rel(c, 'friends', z.id, y) || rel(c, 'allies', z.id, y) || teamOf(c, z.id, y))) return;   // never against their own
      const Z = z.name;
      const bonds = [], helped = [];
      let w = 0;
      Ws.forEach(x => {
        const X = nm(c, x), team = teamOf(c, z.id, x), ally = rel(c, 'allies', z.id, x);
        if (rel(c, 'friends', z.id, x)) { w += 2.5; bonds.push(`${Z} and ${X} are friends`); }
        else if (team) { w += 2.2; bonds.push(`${Z} is in ${team.name} with ${X}`); }
        else if (ally) { w += 1 + 0.4 * ally.level; bonds.push(`${Z} and ${X} are allies${ally.via ? ` ${RL.viaText(c.st, ally)}` : ''}`); }
        else return;
        helped.push(x);
      });
      const against = losers.filter(y => heat(c, z.id, y) || rel(c, 'rivals', z.id, y));
      against.forEach(y => {
        const h = heat(c, z.id, y);
        w += h ? 0.8 + 0.6 * h : 0.8;
        bonds.push(h ? `${Z} holds a grudge against ${nm(c, y)} (heat ${h})` : `${Z} and ${nm(c, y)} are rivals`);
      });
      if (!w) return;
      const on = against.length ? against : m.fall && m.fall.on ? [m.fall.on] : losers;
      const cand = candidate(c, 'interference', `interference:${z.id}:${m.id}`, [z.id, ...Ws, ...on]);
      why(cand, 1 + 0.3 * w, bonds[0]);
      bonds.slice(1).forEach(t => why(cand, 1, t));
      why(cand, 1, `${helped.length ? `${names(c, helped)} beat` : `${names(c, on)} lost to`} ${helped.length ? names(c, on) : names(c, Ws)} at ${c.ev.name}`);
      if (has(c, z.id, 'opportunistic')) why(cand, 1.5, `${Z} is opportunistic — ${helped.length ? 'and will want something for it' : 'and sees an opening'}`);
      if (has(c, z.id, 'cowardly')) why(cand, 1.3, `${Z} is cowardly — happier striking from outside the ring`);
      if (helped.length && has(c, z.id, 'loyal')) why(cand, 1.4, `${Z} is loyal`);
      if (against.length && has(c, z.id, 'hot-headed')) why(cand, 1.3, `${Z} is hot-headed`);
      if (align(c, z.id) === 'heel') why(cand, 1.3, `${Z} is a heel`);
      const needy = Ws.find(x => has(c, x, 'cowardly'));
      if (needy && helped.includes(needy)) why(cand, 1.4, `${nm(c, needy)} is cowardly — and needed the help`);
      if (reign || m.titleId) why(cand, 1.6, `The ${M.titleById(c.st, m.titleId).name} was on the line`);
      else if (m.contender) why(cand, 1.4, `A #1 contender’s match for the ${(M.titleById(c.st, m.contender) || { name: 'title' }).name}`);
      if (has(c, z.id, 'patient')) why(cand, 0.7, `Less likely: ${Z} is patient`);
      if (has(c, z.id, 'respectful')) why(cand, 0.3, `Less likely: ${Z} is respectful — it’s not their fight`);
      cand.plan = { incidents: [{ kind: 'interference', by: [z.id], on, helped, match: m.id }] };
      cand.basis = { match: m.id, winners: Ws };
      if (!freshness(c, cand)) return;
      best.push(finish(c, cand, KIND.interference.base));
    });
    const top = best.sort((a, b) => b.chance - a.chance)[0];
    if (top) out.push(top);
  });
  return out;
}

// who'd run in to save the victims from an attacker - the strongest bond wins
function saverFor(c, attacker, victims, matchId) {
  const ev = c.ev;
  const pool = c.around.filter(z => z.status === 'active' && z.id !== attacker && !victims.includes(z.id));
  let best = null;
  pool.forEach(z => {
    const reasons = [];
    let w = 0;
    victims.forEach(v => {
      const Z = z.name, V = nm(c, v);
      if (rel(c, 'friends', z.id, v)) { w += 3; reasons.push(`${Z} and ${V} are friends`); }
      else if (rel(c, 'allies', z.id, v)) { w += 2.2; reasons.push(`${Z} and ${V} are allies`); }
      if (teamOf(c, z.id, v)) { w += 2; reasons.push(`${Z} is in ${teamOf(c, z.id, v).name} with ${V}`); }
      else if (rel(c, 'former-partners', z.id, v)) { w += 1.2; reasons.push(`${Z} and ${V} are former partners`); }
    });
    const h = heat(c, z.id, attacker);
    if (h) { w += 1 + h; reasons.push(`${z.name} holds a grudge against ${nm(c, attacker)} (heat ${h})`); }
    if (rel(c, 'rivals', z.id, attacker)) { w += 1; reasons.push(`${z.name} and ${nm(c, attacker)} are rivals`); }
    if (!w) return;
    if (z.traits.includes('loyal')) { w *= 1.5; reasons.push(`${z.name} is loyal`); }
    if (z.traits.includes('cowardly')) { w *= 0.4; reasons.push(`Less likely: ${z.name} is cowardly`); }
    const tie = draw(c.seed, ev.id, 'saver', z.id);
    if (!best || w > best.w || (w === best.w && tie > best.tie)) best = { z: z.id, w, reasons, tie };
  });
  if (!best) return null;
  const chance = Math.min(RULES.maxChance, KIND.save.base * (1 + 0.25 * best.w) * c.pace.mult);
  return { saver: best.z, chance, reasons: best.reasons, save: { kind: 'save', by: [best.z], on: [attacker], helped: [...victims], match: matchId } };
}

// how much has built up between two partners: tension, grudges, losing together, ambition
function buildup(c, x, y) {
  const reasons = [];
  let n = 0;
  const T = between(c, x, y, ['tension']);
  if (T) { n += 2 * T; reasons.push(`${nm(c, x)} and ${nm(c, y)} have clashed ${T === 1 ? 'once' : `${T} times`} lately`); }
  const h = heat(c, x, y);
  if (h) { n += h; reasons.push(`${nm(c, x)} holds a grudge against ${nm(c, y)} (heat ${h})`); }
  const together = (c.hist.get(x) || []).filter(e => e.m.sides[e.side].wrestlers.includes(y)).slice(-4);
  const lost = together.filter(e => e.res === 'L').length;
  if (lost >= 2) { n += 1; reasons.push(`They've lost ${lost} of their last ${together.length} together`); }
  if (has(c, x, 'opportunistic')) { n += 1; reasons.push(`${nm(c, x)} is opportunistic`); }
  const theirs = c.st.titles.find(t => { const r = M.currentReign(c.st, t.id); return r && holders(c.st, r.holder).includes(y) && !holders(c.st, r.holder).includes(x); });
  if (theirs && has(c, x, 'ambitious')) { n += 1; reasons.push(`${nm(c, x)} is ambitious, and ${nm(c, y)} holds the ${theirs.name}`); }
  return { n, reasons, tension: T };
}

function betrayals(c) {
  const out = [];
  const pairs = [];
  c.tonight.forEach(m => m.sides.forEach((sd, i) => {
    if (sd.wrestlers.length < 2) return;
    sd.wrestlers.forEach(x => sd.wrestlers.forEach(y => { if (x !== y) pairs.push({ x, y, m, lost: M.resultFor(m, i) === 'L' }); }));
  }));
  const best = new Map();
  pairs.forEach(({ x, y, m, lost }) => {
    if (!spaced(c, 'betrayal')) return;
    const b = buildup(c, x, y);
    const X = nm(c, x), Y = nm(c, y);
    const cand = candidate(c, 'betrayal', `betrayal:${x}>${y}`, [x, y]);
    let base = KIND.betrayal.base;
    // the buildup leads the reasons; teaming up on the night is the setting
    if (b.n >= RULES.betrayalBuildup && (b.tension || heat(c, x, y) >= 2)) {
      b.reasons.forEach(t => why(cand, 1, t));
      why(cand, 1 + 0.25 * (b.n - RULES.betrayalBuildup), 'It has been building');
      if (lost) why(cand, 1.5, 'They just lost together');
    } else if (shockAllowed(c)) {
      cand.shock = true;
      base = RULES.shockChance;
      why(cand, 1, 'A shock — nothing much built up to this');
    } else return;
    why(cand, 1, `${X} teamed with ${Y} at ${c.ev.name}`);
    if (has(c, x, 'loyal')) why(cand, 0.2, `Less likely: ${X} is loyal`);
    if (rel(c, 'friends', x, y)) why(cand, 0.5, `Less likely: ${X} and ${Y} are friends`);
    // partners in a team trust each other fully until something gives them a reason not to
    const trust = teamOf(c, x, y) ? rel(c, 'allies', x, y) : null;
    if (trust && trust.level >= 3) why(cand, 0.6, `Less likely: ${X} and ${Y} still trust each other (allies ${trust.level})`);
    else if (teamOf(c, x, y)) why(cand, 1.3, trust ? `The trust between them is down to ${trust.level}` : `There's no trust left between them`);
    const incs = [{ kind: 'betrayal', by: [x], on: [y], match: m.id }];
    // a face who turns on a partner after all that has turned heel
    if (align(c, x) === 'face' && b.n >= RULES.betrayalBuildup + 2 && spaced(c, 'turn') && turnGapOk(c, x)) {
      incs.push({ kind: 'turn', by: [x], to: 'heel' });
      why(cand, 1, `${X} was a face — no longer`);
    }
    // a team that had been fraying doesn't survive it
    const team = teamOf(c, x, y);
    const splits = team && (b.tension >= RULES.breakupTension || b.n >= RULES.betrayalBuildup + 2)
      && !M.titlesHeldBy(c.st, { type: 'team', id: team.id }).length && spaced(c, 'breakup');
    if (splits) {
      incs.push({ kind: 'breakup', by: [x], on: team.members.filter(id => id !== x), team: team.id });
      why(cand, 1, `${team.name} can't survive it`);
    }
    cand.plan = { incidents: incs, disband: splits ? team.id : null };
    cand.basis = { match: m.id, winners: winnersOf(m) };
    if (!freshness(c, cand)) return;
    finish(c, cand, base);
    const k = [x, y].sort().join('+');
    if (!best.has(k) || best.get(k).chance < cand.chance) best.set(k, cand);
  });
  out.push(...best.values());
  return out;
}
const turnGapOk = (c, id) => !c.incidents.some(x => x.incident.kind === 'turn' && x.incident.by.includes(id) && c.wk - x.wk < RULES.turnGapWeeks);

function brawls(c) {
  const out = [];
  const ids = [...c.onCard].sort();
  const together = (a, b) => c.tonight.find(m => m.sides.some(sd => sd.wrestlers.includes(a)) && m.sides.some(sd => sd.wrestlers.includes(b)));
  ids.forEach((a, i) => ids.slice(i + 1).forEach(b => {
    const rv = rel(c, 'rivals', a, b), ha = heat(c, a, b), hb = heat(c, b, a);
    const bad = (rv ? rv.level : 0) + ha + hb;
    const m = together(a, b);
    if (bad < 2 || (!m && bad < 4)) return;
    if (m && !c.focus && c.phase === 'post' && c.st.story.rolls.some(r => r.event === c.ev.id && r.match === m.id)) return;   // dealt with straight after it
    const [x, y] = ha >= hb ? [a, b] : [b, a];
    const cand = candidate(c, 'brawl', `brawl:${a}+${b}`, [a, b]);
    const A = nm(c, a), B = nm(c, b);
    if (rv) why(cand, 1, `${A} and ${B} are rivals (heat ${rv.level})`);
    if (ha) why(cand, 1, `${A} holds a grudge against ${B} (heat ${ha})`);
    if (hb) why(cand, 1, `${B} holds a grudge against ${A} (heat ${hb})`);
    why(cand, 1 + 0.3 * bad, bad >= 4 ? 'There’s a lot of bad blood between them' : 'There’s bad blood between them');
    if (m) why(cand, 1.6, `They were in the same match at ${c.ev.name}`);
    if (has(c, a, 'hot-headed') || has(c, b, 'hot-headed')) why(cand, 1.4, `${has(c, a, 'hot-headed') ? A : B} is hot-headed`);
    cand.plan = { incidents: [{ kind: 'brawl', by: [x], on: [y], match: m ? m.id : null }] };
    cand.basis = m ? { match: m.id, winners: winnersOf(m) } : null;
    if (!freshness(c, cand)) return;
    out.push(finish(c, cand, KIND.brawl.base));
  }));
  return out;
}

// friction in a team: losing together, ambition, bad blood
function tensions(c) {
  const out = [];
  const teams = c.st.teams.filter(t => t.active && t.members.length >= 2 && t.members.some(id => c.phase === 'post' ? c.onCard.has(id) : c.around.some(w => w.id === id)));
  teams.forEach(t => {
    const results = M.teamMatches(c.st, t.id).filter(x => M.compareStamps(c.st, x.event.at, c.ev.at) <= 0);
    const last3 = results.slice(0, 3), lost = last3.filter(x => M.resultFor(x.match, x.side) === 'L').length;
    const tonight = results.find(x => x.event.id === c.ev.id);
    let by = null, score = -1;
    t.members.forEach(x => {
      let s = 0;
      if (has(c, x, 'opportunistic')) s += 2;
      if (has(c, x, 'ambitious')) s += 1.5;
      if (has(c, x, 'hot-headed')) s += 1;
      const r = run(c, x);
      if (r.res === 'W' && r.n >= 2 && (c.hist.get(x) || []).slice(-r.n).every(e => e.m.sides[e.side].wrestlers.length === 1)) s += 1.5;
      if (s > score) { by = x; score = s; }
    });
    const on = t.members.filter(id => id !== by);
    const cand = candidate(c, 'tension', `tension:${t.id}:${by}`, [...t.members]);
    const B = nm(c, by);
    // what set it off comes first - a loss, a grudge, a partner's own ambitions - and being a team last
    if (c.phase === 'post' && tonight && M.resultFor(tonight.match, tonight.side) === 'L') why(cand, 1.6, `${t.name} lost at ${c.ev.name}`);
    if (lost >= 2) why(cand, 1 + 0.5 * lost, `${t.name} have lost ${lost} of their last ${last3.length}`);
    on.forEach(y => { const h = heat(c, by, y); if (h) why(cand, 1 + h, `${B} holds a grudge against ${nm(c, y)} (heat ${h})`); });
    const T = on.reduce((n, y) => n + between(c, by, y, ['tension']), 0);
    if (T) why(cand, 1.4, `It's not the first time (${T} before)`);
    const r = run(c, by);
    if (r.res === 'W' && r.n >= 2) why(cand, 1.3, `${B} has been winning on their own — ${r.n} straight`);
    if (has(c, by, 'opportunistic')) why(cand, 2, `${B} is opportunistic — out for number one`);
    if (has(c, by, 'ambitious')) why(cand, 1.5, `${B} is ambitious`);
    if (has(c, by, 'hot-headed')) why(cand, 1.3, `${B} is hot-headed`);
    why(cand, 1, `${B} is in ${t.name} with ${names(c, on)}`);
    outOfNowhere(cand, 0.2);
    if (t.members.every(x => has(c, x, 'loyal'))) why(cand, 0.3, `Less likely: they're all loyal`);
    else if (on.some(y => rel(c, 'friends', by, y))) why(cand, 0.5, `Less likely: they're friends`);
    if (M.titlesHeldBy(c.st, { type: 'team', id: t.id }).length) why(cand, 0.5, `Less likely: they're champions`);
    cand.plan = { incidents: [{ kind: 'tension', by: [by], on, team: t.id, match: c.phase === 'post' && tonight ? tonight.match.id : null }] };
    cand.basis = c.phase === 'post' && tonight ? { match: tonight.match.id, winners: winnersOf(tonight.match) } : null;
    if (!freshness(c, cand)) return;
    out.push(finish(c, cand, KIND.tension.base));
  });
  return out;
}

// a team splits only once it has been fraying for a while
function breakups(c) {
  const out = [];
  if (!spaced(c, 'breakup')) return out;
  c.st.teams.filter(t => t.active && t.members.some(id => c.onCard.has(id))).forEach(t => {
    if (M.titlesHeldBy(c.st, { type: 'team', id: t.id }).length) return;       // champions don't split mid-reign
    const results = M.teamMatches(c.st, t.id).filter(x => M.compareStamps(c.st, x.event.at, c.ev.at) <= 0);
    const last4 = results.slice(0, 4), lost = last4.filter(x => M.resultFor(x.match, x.side) === 'L').length;
    const T = t.members.reduce((n, x, i) => n + t.members.slice(i + 1).reduce((k, y) => k + between(c, x, y, ['tension']), 0), 0);
    if (T < RULES.breakupTension) return;                    // two separate clashes, at least: it has to have been building
    const cand = candidate(c, 'breakup', `breakup:${t.id}`, [...t.members]);
    why(cand, 1, `${t.name} have clashed ${T === 1 ? 'once' : `${T} times`} in the last ${RULES.buildupWeeks} weeks`);
    const tonight = results.find(x => x.event.id === c.ev.id);
    if (tonight && M.resultFor(tonight.match, tonight.side) === 'L') why(cand, 1.5, `${t.name} lost at ${c.ev.name}`);
    if (lost >= 3) why(cand, 1.4, `${t.name} have lost ${lost} of their last ${last4.length}`);
    let walker = null, ws = 0;
    t.members.forEach(x => {
      let s = 0;
      t.members.forEach(y => { const h = x !== y && heat(c, x, y); if (h) s += 2 * h; });
      if (has(c, x, 'opportunistic')) s += 2;
      if (has(c, x, 'ambitious')) s += 1;
      if (s > ws) { walker = x; ws = s; }
    });
    if (walker) why(cand, 1.2, `${nm(c, walker)} has had enough`);
    if (t.members.some((x, i) => t.members.slice(i + 1).some(y => rel(c, 'friends', x, y)))) why(cand, 0.5, `Less likely: there are friends in ${t.name}`);
    cand.plan = { incidents: [{ kind: 'breakup', by: walker ? [walker] : [...t.members], on: walker ? t.members.filter(x => x !== walker) : [],
      team: t.id, match: tonight ? tonight.match.id : null }], disband: t.id };
    cand.basis = null;
    if (!freshness(c, cand)) return;
    out.push(finish(c, cand, KIND.breakup.base));
  });
  return out;
}

// an underdog's run, or an upset, gets noticed
function rises(c) {
  const out = [];
  // down the table (once there's a table), or losing more than winning before this
  const table = c.rank.size >= 4;
  c.tonight.forEach(m => winnersOf(m).forEach(id => {
    const r = run(c, id);
    const rk = c.rank.get(id);
    const beaten = m.sides.filter((_, i) => i !== m.winner).flatMap(sd => sd.wrestlers);
    const champBeaten = beaten.filter(b => championOn(c.st, b, c.ev) && !championOn(c.st, id, c.ev));
    const reign = c.st.reigns.find(x => x.matchId === m.id);
    const before = (c.hist.get(id) || []).slice(0, -r.n).slice(-10);
    const bw = before.filter(x => x.res === 'W').length, bl = before.filter(x => x.res === 'L').length;
    const byRank = table && (!rk || rk / c.size > 0.5), byRecord = before.length >= 2 && bl > bw;
    const low = byRank || byRecord;
    const from = byRank ? (rk ? `from ${ordinal(rk)} of ${c.size}` : 'from outside the rankings') : `after going ${bw}–${bl}`;
    const unlikelyRun = r.res === 'W' && r.n >= RULES.streakMin && before.length >= 3 && bw / before.length < 0.45;
    if (!unlikelyRun && !(low && (champBeaten.length || reign))) return;
    const cand = candidate(c, 'rise', `rise:${id}`, [id]);
    const X = nm(c, id);
    if (reign && low) why(cand, 3, `${X} won the ${M.titleById(c.st, reign.titleId).name} ${from}`);
    else if (champBeaten.length && low) why(cand, 2, `${X} beat ${names(c, champBeaten)}, a champion, ${from}`);
    if (unlikelyRun) {
      why(cand, 1 + 0.25 * (r.n - RULES.streakMin), `${X} has won ${r.n} straight`);
      why(cand, 1, `Before this run: ${bw} win${bw === 1 ? '' : 's'} and ${bl} loss${bl === 1 ? '' : 'es'} in their last ${before.length}`);
    }
    cand.plan = { incidents: [{ kind: 'momentum', by: [id], match: m.id }] };
    cand.basis = { match: m.id, winners: winnersOf(m) };
    if (!freshness(c, cand)) return;
    out.push(finish(c, cand, KIND.rise.base));
  }));
  return out;
}

// a hard-fought match between rivals ends with a handshake
function respects(c) {
  const out = [];
  c.tonight.forEach(m => {
    if (m.sides.length !== 2) return;
    const [A, B] = m.sides.map(sd => sd.wrestlers);
    A.forEach(a => B.forEach(b => {
      const bad = [rel(c, 'rivals', a, b), rel(c, 'grudge', a, b), rel(c, 'grudge', b, a)].filter(Boolean);
      if (!bad.length || bad.some(r => r.kind === 'grudge' && r.level >= 3)) return;       // nothing to cool, or too far gone
      if (bad.every(r => r.since && M.compareStamps(c.st, r.since, c.ev.at) >= 0)) return;  // it only started tonight
      const cand = candidate(c, 'respect', `respect:${[a, b].sort().join('+')}`, [a, b]);
      const [x, y] = m.outcome === 'win' && A.includes(a) === (m.winner === 0) ? [b, a] : [a, b];    // the loser offers it
      why(cand, 1, `${nm(c, a)} and ${nm(c, b)} fought it out at ${c.ev.name}`);
      bad.forEach(r => why(cand, 1, `${RL.relText(c.st, r)}${RL.levelText(r) ? ` (${RL.levelText(r)})` : ''}`));
      const kind = [a, b].filter(id => has(c, id, 'respectful'));
      if (kind.length) why(cand, 2.5, `${names(c, kind)} ${kind.length > 1 ? 'are' : 'is'} respectful`);
      if (has(c, x, 'patient')) why(cand, 1.3, `${nm(c, x)} is patient`);
      if ([a, b].some(id => has(c, id, 'hot-headed'))) why(cand, 0.4, 'Less likely: there’s a hot head involved');
      if ([a, b].some(id => has(c, id, 'proud')) && m.outcome === 'win') why(cand, 0.6, 'Less likely: pride is at stake');
      outOfNowhere(cand, 0.3);
      cand.plan = { incidents: [{ kind: 'truce', by: [x], on: [y], match: m.id }] };
      cand.basis = { match: m.id, winners: winnersOf(m) };
      if (!freshness(c, cand)) return;
      out.push(finish(c, cand, KIND.respect.base));
    }));
  });
  return out;
}

// everyone who could step up for a title, weighted - nobody is ranked out
function contendersOf(c, t, reign, showId) {
  const st = c.st;
  const champs = holders(st, reign.holder);
  const champName = M.holderName(st, reign.holder);
  const pool = t.kind === 'tag'
    ? st.teams.filter(tm => tm.active && tm.id !== reign.holder.id && !tm.members.some(id => champs.includes(id))
      && tm.members.every(id => { const w = W(c, id); return w && w.showId === showId && w.status === 'active' && fits(w, t); }))
      .map(tm => ({ ids: [...tm.members], name: tm.name, team: tm.id }))
    : st.wrestlers.filter(w => w.showId === showId && w.status === 'active' && !champs.includes(w.id) && fits(w, t))
      .map(w => ({ ids: [w.id], name: w.name }));
  const nc = M.numberOneContender(st, t.id);
  return pool.map(k => {
    const reasons = [];
    let w = 1;
    const lead = k.ids[0];
    const h = Math.max(...k.ids.flatMap(x => champs.map(y => heat(c, x, y))));
    if (h) { w += 1.5 * h; reasons.push(`${k.name} holds a grudge against ${champName} (heat ${h})`); }
    if (k.ids.some(x => champs.some(y => rel(c, 'rivals', x, y)))) { w += 1; reasons.push(`${k.name} and ${champName} are rivals`); }
    const beat = (c.hist.get(lead) || []).filter(e => c.wk - e.wk < 6 && e.res === 'W'
      && e.m.sides.some((sd, i) => i !== e.side && sd.wrestlers.some(id => champs.includes(id))));
    if (beat.length) { w += 2; reasons.push(`${k.name} beat ${champName} at ${beat[beat.length - 1].ev.name}`); }
    const mo = momentumOf(st, lead, c.hist);
    if (mo.label === 'hot') { w += 2; reasons.push(`${k.name} is hot — ${mo.form.slice(-4)}`); }
    else if (mo.label === 'rising') { w += 1; reasons.push(`${k.name} is on the rise`); }
    if (nc &&(nc.holder.type === 'team' ? nc.holder.id === k.team : k.ids.length === 1 && k.ids[0] === nc.holder.id)) {
      w += 4;
      reasons.unshift(`${k.name} won the #1 contender’s match at ${nc.event.name}`);
      k.contender = nc;
    }
    const lately = kind => c.incidents.some(x => x.incident.kind === kind && x.incident.by.some(id => k.ids.includes(id)) && c.wk - x.wk < RULES.repeatWeeks);
    if (lately('momentum')) { w += 1.5; reasons.push(`${k.name}'s run has everyone talking`); }
    if (lately('demand') || lately('open-challenge')) { w += 1.5; reasons.push(`${k.name} demanded an opportunity recently`); }
    if (k.ids.some(x => has(c, x, 'ambitious'))) { w *= 1.5; reasons.push(`${k.name} ${k.ids.length > 1 ? 'have ambition' : 'is ambitious'}`); }
    return { ...k, w, reasons };
  });
}
const titleShow = (c, t, reign) => t.showId || (W(c, holders(c.st, reign.holder)[0]) || {}).showId;

function challenges(c) {
  const st = c.st, out = [];
  st.titles.filter(t => t.active).forEach(t => {
    const reign = M.currentReign(st, t.id);
    if (!reign) return;
    const champs = holders(st, reign.holder);
    const champAppeared = champs.some(id => c.onCard.has(id));
    const showId = titleShow(c, t, reign);
    const about = m => m.titleId === t.id || m.contender === t.id || m.sides.some(sd => sd.wrestlers.some(id => champs.includes(id)));
    if (c.focus && !about(c.focus)) return;                       // straight after a match: only a title it was about
    if (!c.focus && c.st.story.rolls.some(r => r.event === c.ev.id && r.match && c.tonight.some(m => m.id === r.match && about(m)))) return;
    if (!champAppeared && c.ev.showId && showId !== c.ev.showId) return;
    const champName = M.holderName(st, reign.holder);
    const contenders = contendersOf(c, t, reign, showId);
    if (!contenders.length) return;
    const total = contenders.reduce((n, k) => n + k.w, 0);
    let x = draw(c.seed, c.ev.id, c.phase, c.nonce, 'contender', t.id) * total;
    const pick = contenders.find(k => (x -= k.w) < 0) || contenders[contenders.length - 1];
    const cand = candidate(c, 'challenge', `challenge:${t.id}:${[...pick.ids].sort().join('+')}`, [...pick.ids, ...champs]);
    why(cand, 1, `${champName} ${champs.length > 1 ? 'hold' : 'holds'} the ${t.name}`);
    if (champAppeared) why(cand, 1.4, `${champName} wrestled at ${c.ev.name}`);
    const lastTitleMatch = st.events.filter(e => e.matches.some(m => m.status === 'played' && m.titleId === t.id)).map(e => weekNo(st, e.at))
      .filter(n => n <= c.wk).sort((a, b) => b - a)[0];
    const quiet = lastTitleMatch == null ? c.wk - weekNo(st, reign.start) : c.wk - lastTitleMatch;
    if (quiet >= 4) why(cand, 1.5, `The ${t.name} hasn't been on the line in ${quiet} weeks`);
    pick.reasons.forEach(r => why(cand, 1, r));
    if (pick.contender && pick.contender.event.id === c.ev.id) why(cand, 3, `${pick.name} just earned the shot`);
    why(cand, 1, `${pick.name} came up from ${contenders.length} possible challenger${contenders.length === 1 ? '' : 's'} — anyone eligible can, and the rankings don't decide it (${pct(pick.w / total)} of the draw)`);
    if (weekNo(st, reign.start) >= c.wk - 1) why(cand, 0.5, `Less likely: ${champName} only just won it`);
    cand.plan = { incidents: [{ kind: 'challenge', by: [...pick.ids], on: [...champs], title: t.id }] };
    cand.basis = { title: { id: t.id, holder: reign.holder } };
    if (!freshness(c, cand)) return;
    out.push(finish(c, cand, KIND.challenge.base));
  });
  return out;
}

// turns: a face who keeps attacking people goes heel; a heel who keeps doing right goes face
function turns(c) {
  const out = [];
  if (!spaced(c, 'turn')) return out;
  const pool = c.phase === 'post' ? c.around.filter(w => c.onCard.has(w.id)) : c.around;
  pool.forEach(w => {
    if (!w.alignment || w.alignment === 'tweener' || !turnGapOk(c, w.id)) return;
    const mine = kinds => c.incidents.filter(x => kinds.includes(x.incident.kind) && x.incident.by.includes(w.id) && c.wk - x.wk < RULES.buildupWeeks);
    const cand = candidate(c, 'turn', `turn:${w.id}`, [w.id]);
    let to = null;
    if (w.alignment === 'face') {
      const bad = mine(['attack', 'betrayal']);
      if (bad.length < 2) return;
      to = 'heel';
      why(cand, 1, `${w.name} has ${bad.map(x => x.incident.kind === 'betrayal' ? 'betrayed' : 'attacked').filter((v, i, a) => a.indexOf(v) === i).join(' and ')} ${bad.length} times in ${RULES.buildupWeeks} weeks`);
      why(cand, 1 + 0.3 * (bad.length - 2), 'The crowd has turned on them');
      if (has(c, w.id, 'hot-headed') || has(c, w.id, 'opportunistic')) why(cand, 1.3, `${w.name} is ${has(c, w.id, 'opportunistic') ? 'opportunistic' : 'hot-headed'}`);
    } else {
      const good = mine(['save', 'alliance', 'truce']);
      const wronged = c.incidents.filter(x => ['betrayal', 'attack'].includes(x.incident.kind) && x.incident.on.includes(w.id)
        && c.wk - x.wk < RULES.buildupWeeks && x.incident.by.some(id => align(c, id) === 'heel'));
      if (good.length + wronged.length < 2) return;
      to = 'face';
      if (good.length) why(cand, 1, `${w.name} has done right by others ${good.length === 1 ? 'once' : `${good.length} times`} lately`);
      if (wronged.length) why(cand, 1.2, `${w.name} has been turned on by their own side`);
      if (has(c, w.id, 'respectful') || has(c, w.id, 'loyal')) why(cand, 1.5, `${w.name} is ${has(c, w.id, 'respectful') ? 'respectful' : 'loyal'}`);
    }
    cand.plan = { incidents: [{ kind: 'turn', by: [w.id], to }] };
    if (!freshness(c, cand)) return;
    out.push(finish(c, cand, KIND.turn.base * 0.4));
  });
  return out;
}

// ================================================================ before the show

function confrontations(c) {
  const out = [];
  const ids = c.around.filter(w => w.status === 'active').map(w => w.id).sort();
  const facing = (a, b) => c.booked.find(m => {
    const sa = m.sides.findIndex(sd => sd.wrestlers.includes(a)), sb = m.sides.findIndex(sd => sd.wrestlers.includes(b));
    return sa >= 0 && sb >= 0 && sa !== sb;
  });
  const own = r => (!r ? 0 : r.via ? r.own || 0 : r.level);          // bad blood only through their teams: the teams face off instead
  ids.forEach((a, i) => ids.slice(i + 1).forEach(b => {
    const rv = rel(c, 'rivals', a, b), ha = heat(c, a, b), hb = heat(c, b, a);
    const bad = (rv ? rv.level : 0) + ha + hb;
    if (!bad || !(own(rv) + own(rel(c, 'grudge', a, b)) + own(rel(c, 'grudge', b, a)))) return;
    if (between(c, a, b, ['confrontation', 'brawl'], 2)) return;
    const [x, y] = ha >= hb ? [a, b] : [b, a];
    const cand = candidate(c, 'confrontation', `confrontation:${[a, b].sort().join('+')}`, [a, b]);
    const X = nm(c, x), Y = nm(c, y);
    if (rv) why(cand, 1, `${X} and ${Y} are rivals`);
    if (ha || hb) why(cand, 1 + 0.4 * Math.max(ha, hb), `${X} holds a grudge against ${Y} (heat ${Math.max(ha, hb)})`);
    const m = facing(a, b);
    if (m) why(cand, 2.5, `They're booked to face each other at ${c.ev.name}${m.titleId ? ` for the ${M.titleById(c.st, m.titleId).name}` : ''}`);
    if (has(c, x, 'hot-headed')) why(cand, 1.3, `${X} is hot-headed`);
    if (has(c, x, 'cowardly')) why(cand, 0.5, `Less likely: ${X} is cowardly`);
    cand.plan = { incidents: [{ kind: 'confrontation', by: [x], on: [y] }] };
    if (!freshness(c, cand)) return;
    out.push(finish(c, cand, KIND.confrontation.base));
  }));
  return out;
}

// two tag teams at odds, both here, face off as teams
function teamConfrontations(c) {
  const out = [];
  const here = new Set(c.around.filter(w => w.status === 'active').map(w => w.id));
  const trel = (kind, x, y) => { const r = c.d.teams.get(RL.teamRelKey(kind, x, y)); return r && r.active ? r : null; };
  const seen = new Set();
  [...c.d.teams.values()].filter(r => r.active && r.kind !== 'allies').forEach(r => {
    const key = [r.a, r.b].sort().join('+');
    if (seen.has(key)) return;
    seen.add(key);
    const A = M.teamById(c.st, r.a), B = M.teamById(c.st, r.b);
    if (!A || !B || !A.active || !B.active || ![A, B].every(t => t.members.every(id => here.has(id)))) return;
    if (A.members.some(a => B.members.some(b => between(c, a, b, ['confrontation', 'brawl'], 2)))) return;
    const ga = trel('grudge', A.id, B.id), gb = trel('grudge', B.id, A.id), rv = trel('rivals', A.id, B.id);
    const [x, y] = (ga ? ga.level : 0) >= (gb ? gb.level : 0) ? [A, B] : [B, A];
    const cand = candidate(c, 'confrontation', `confrontation:${key}`, [...A.members, ...B.members]);
    [ga, gb, rv].filter(Boolean).forEach(z => why(cand, 1 + 0.4 * z.level, `${RL.teamRelText(c.st, z)} (heat ${z.level})`));
    const facing = c.booked.find(m => {
      const sa = m.sides.findIndex(sd => sd.wrestlers.some(id => A.members.includes(id))), sb = m.sides.findIndex(sd => sd.wrestlers.some(id => B.members.includes(id)));
      return sa >= 0 && sb >= 0 && sa !== sb;
    });
    if (facing) why(cand, 2.5, `They're booked against each other at ${c.ev.name}`);
    const hot = x.members.find(id => has(c, id, 'hot-headed'));
    if (hot) why(cand, 1.3, `${nm(c, hot)} of ${x.name} is hot-headed`);
    if (x.members.every(id => has(c, id, 'cowardly'))) why(cand, 0.5, `Less likely: ${x.name} are cowardly`);
    cand.plan = { incidents: [{ kind: 'confrontation', by: [...x.members], on: [...y.members] }] };
    if (!freshness(c, cand)) return;
    out.push(finish(c, cand, KIND.confrontation.base));
  });
  return out;
}

// someone on a run - or hungry for gold - demands a shot at a title on their show
function demands(c) {
  const st = c.st, out = [];
  st.titles.filter(t => t.active && t.kind === 'singles').forEach(t => {
    const reign = M.currentReign(st, t.id);
    if (!reign) return;
    const showId = titleShow(c, t, reign);
    if (c.ev.showId && showId !== c.ev.showId) return;
    const champs = holders(st, reign.holder);
    const best = [];
    const nc = M.numberOneContender(st, t.id);
    c.around.filter(w => w.showId === showId && w.status === 'active' && !champs.includes(w.id) && fits(w, t)).forEach(w => {
      const mo = momentumOf(st, w.id, c.hist);
      const cand = candidate(c, 'demand', `demand:${w.id}:${t.id}`, [w.id, ...champs]);
      const ambitious = w.traits.includes('ambitious');
      if (mo.label === 'hot') why(cand, 3, `${w.name} is hot — ${mo.reasons[0] || mo.form}`);
      else if (mo.label === 'rising') why(cand, 2, `${w.name} is on the rise${mo.reasons[0] ? ` — ${mo.reasons[0]}` : ''}`);
      const beat = (c.hist.get(w.id) || []).some(e => c.wk - e.wk < 6 && e.res === 'W' && e.m.sides.some((sd, i) => i !== e.side && sd.wrestlers.some(id => champs.includes(id))));
      if (beat) why(cand, 2, `${w.name} has beaten ${M.holderName(st, reign.holder)} lately`);
      const next = nc &&nc.holder.type === 'wrestler' && nc.holder.id === w.id;
      if (next) why(cand, 3, `${w.name} is #1 contender — won the #1 contender’s match at ${nc.event.name} — and wants the match`);
      if (!mo.label.match(/hot|rising/) && !beat && !ambitious && !next) return;
      if (ambitious) why(cand, 1.8, `${w.name} is ambitious`);
      if (w.traits.includes('proud')) why(cand, 1.3, `${w.name} is proud`);
      if (w.traits.includes('patient')) why(cand, 0.5, `Less likely: ${w.name} is patient`);
      if (goal(c, w.id) === `Win the ${t.name}`) why(cand, 1.2, `${w.name} is after the ${t.name}`);
      const rk = c.rank.get(w.id);
      if (rk && c.size >= 4 && rk / c.size > 0.5 && mo.label !== 'steady') why(cand, 1, `From ${ordinal(rk)} of ${c.size} — the rankings don't stop anyone asking`);
      cand.plan = { incidents: [{ kind: 'demand', by: [w.id], on: [...champs], title: t.id }] };
      cand.basis = { title: { id: t.id, holder: reign.holder } };
      if (!freshness(c, cand)) return;
      best.push(finish(c, cand, KIND.demand.base));
    });
    const top = best.sort((a, b) => b.chance - a.chance)[0];
    if (top) out.push(top);
  });
  return out;
}

// a champion who wants a fight, or anyone who needs one, lays down an open challenge
function openChallenges(c) {
  const st = c.st, out = [];
  c.around.filter(w => w.status === 'active').forEach(w => {
    const held = st.titles.find(t => t.active && t.kind === 'singles' && (() => { const r = M.currentReign(st, t.id); return r && holders(st, r.holder).includes(w.id); })());
    const mo = momentumOf(st, w.id, c.hist);
    const cand = candidate(c, 'open-challenge', `open:${w.id}`, [w.id]);
    if (held) {
      const last = st.events.filter(e => e.matches.some(m => m.status === 'played' && m.titleId === held.id)).map(e => weekNo(st, e.at))
        .filter(n => n <= c.wk).sort((a, b) => b - a)[0];
      const quiet = last == null ? 99 : c.wk - last;
      why(cand, 1, `${w.name} holds the ${held.name}`);
      if (quiet >= 3) why(cand, 1.8, quiet >= 99 ? 'They haven\'t defended it yet' : `No defence in ${quiet} weeks`);
      if (w.traits.includes('proud')) why(cand, 1.8, `${w.name} is proud`);
      if (w.traits.includes('cowardly')) why(cand, 0.2, `Less likely: ${w.name} is cowardly`);
      if (align(c, w.id) === 'face') why(cand, 1.2, `${w.name} is a fighting champion`);
    } else {
      if (mo.label !== 'hot') return;
      why(cand, 1.5, `${w.name} is hot — ${mo.reasons[0] || mo.form} — and wants anyone`);
      if (w.traits.includes('proud') || w.traits.includes('ambitious')) why(cand, 1.5, `${w.name} is ${w.traits.includes('proud') ? 'proud' : 'ambitious'}`);
    }
    outOfNowhere(cand, 0.4);
    cand.plan = { incidents: [{ kind: 'open-challenge', by: [w.id], title: held ? held.id : null }] };
    cand.basis = held ? { title: { id: held.id, holder: M.currentReign(st, held.id).holder } } : null;
    if (!freshness(c, cand)) return;
    out.push(finish(c, cand, KIND['open-challenge'].base));
  });
  return out;
}

// the enemy of my enemy: two with a grudge against the same person join forces
function alliances(c) {
  const out = [];
  const ids = c.around.filter(w => w.status === 'active').map(w => w.id).sort();
  ids.forEach((a, i) => ids.slice(i + 1).forEach(b => {
    // already on a team together, they're partners - nothing new to join
    if (heat(c, a, b) || heat(c, b, a) || rel(c, 'allies', a, b) || rel(c, 'rivals', a, b) || teamOf(c, a, b)) return;
    const foes = [...c.d.rels.values()].filter(r => r.active && r.kind === 'grudge' && r.a === a && heat(c, b, r.b)).map(r => r.b);
    const saved = c.incidents.find(x => x.incident.kind === 'save' && c.wk - x.wk < 4
      && ((x.incident.by.includes(a) && x.incident.helped.includes(b)) || (x.incident.by.includes(b) && x.incident.helped.includes(a))));
    if (!foes.length && !saved) return;
    const cand = candidate(c, 'alliance', `alliance:${[a, b].sort().join('+')}`, [a, b]);
    if (foes.length) why(cand, 1 + 0.5 * (heat(c, a, foes[0]) + heat(c, b, foes[0])), `${nm(c, a)} and ${nm(c, b)} both hold a grudge against ${nm(c, foes[0])}`);
    if (saved) why(cand, 2, `${names(c, saved.incident.by)} made the save for ${names(c, saved.incident.helped)} at ${saved.event.name}`);
    if (align(c, a) && align(c, a) === align(c, b)) why(cand, 1.3, `Both are ${align(c, a)}s`);
    else if (align(c, a) && align(c, b) && align(c, a) !== align(c, b)) why(cand, 0.4, 'Less likely: a face and a heel');
    if ([a, b].some(id => has(c, id, 'opportunistic'))) why(cand, 1.2, `${names(c, [a, b].filter(id => has(c, id, 'opportunistic')))} sees an opening`);
    const [x, y] = [a, b];
    cand.plan = { incidents: [{ kind: 'alliance', by: [x], on: [y] }] };
    if (!freshness(c, cand)) return;
    out.push(finish(c, cand, KIND.alliance.base));
  }));
  return out;
}

// a rivalry that has gone quiet cools off
function coolings(c) {
  const out = [];
  const seen = new Set();
  [...c.d.rels.values()].filter(r => r.active && (r.kind === 'rivals' || r.kind === 'grudge')).forEach(r => {
    const [a, b] = [r.a, r.b].sort();
    if (seen.has(`${a}+${b}`)) return;
    seen.add(`${a}+${b}`);
    if (!c.around.some(w => w.id === a || w.id === b)) return;
    const lastMeet = Math.max(-99, ...(c.hist.get(a) || []).filter(e => e.m.sides.some(sd => sd.wrestlers.includes(b))).map(e => e.wk));
    const lastInc = Math.max(-99, ...c.incidents.filter(x => [...x.incident.by, ...x.incident.on].includes(a) && [...x.incident.by, ...x.incident.on].includes(b)).map(x => x.wk));
    const quiet = c.wk - Math.max(lastMeet, lastInc);
    if (quiet < RULES.dormantWeeks) return;
    const cand = candidate(c, 'cooling', `cooling:${a}+${b}`, [a, b]);
    why(cand, 1 + 0.1 * Math.min(10, quiet - RULES.dormantWeeks), `Nothing between ${nm(c, a)} and ${nm(c, b)} for ${quiet >= 50 ? 'a long time' : `${quiet} weeks`}`);
    if ((W(c, a) || {}).showId !== (W(c, b) || {}).showId) why(cand, 2, 'They’re on different shows now');
    [a, b].forEach(id => {
      if (has(c, id, 'patient') || has(c, id, 'respectful')) why(cand, 1.4, `${nm(c, id)} is ${has(c, id, 'patient') ? 'patient' : 'respectful'}`);
      if (has(c, id, 'hot-headed')) why(cand, 0.5, `Less likely: ${nm(c, id)} is hot-headed`);
    });
    if (Math.max(heat(c, a, b), heat(c, b, a)) >= 3) why(cand, 0.4, 'Less likely: it runs deep');
    cand.plan = { incidents: [{ kind: 'truce', by: [a], on: [b] }] };
    if (!freshness(c, cand)) return;
    out.push(finish(c, cand, KIND.cooling.base));
  });
  return out;
}

// ================================================================ a show, before or after

// every possibility for a part of a show, with its plan, its reasons and its chance
function possible(c) {
  if (c.phase === 'pre') return [...confrontations(c), ...teamConfrontations(c), ...demands(c), ...openChallenges(c), ...alliances(c), ...coolings(c), ...tensions(c), ...turns(c)];
  // after the show: only what wasn't about one match (brawls and challenges leave out what came up straight after one)
  if (!c.focus) return [...brawls(c), ...challenges(c)];
  // straight after a match: everything about it happens then and there
  const all = [...attacks(c), ...interferences(c), ...betrayals(c), ...brawls(c), ...tensions(c), ...breakups(c), ...rises(c), ...respects(c), ...challenges(c), ...turns(c)];
  all.forEach(k => { k.plan.incidents = k.plan.incidents.map(i => ({ ...i, match: i.match || c.focus.id })); });
  return all;
}
/**
 * Everything the director would weigh around a show, before any draw: [{ kind,
 * key, incidents, why, chance }] - what each would record, and why. `matchId`:
 * straight after that match.
 */
export function possibilities(st, eventId, phase, matchId = null) {
  const ev = M.eventById(st, eventId);
  if (!ev) return [];
  return possible(context(st, ev, phase, 0, matchId)).map(k => ({ kind: k.kind, key: k.key, incidents: k.plan.incidents, why: k.factors.map(f => f.text),
    chance: k.chance, extra: k.extra }));
}

/**
 * What the director does around a show: `phase` 'pre' (before its matches) or
 * 'post' (after its results). `nonce` is 0 the first time, and counts up when
 * the owner asks for a show to be run again. Returns { pool, picked,
 * considered, cap } - `picked` ready for model.saveDirectorRoll, `considered`
 * every possibility with its chance and draw, for the log.
 */
export function lookAt(st, eventId, phase, nonce = 0, matchId = null) {
  const ev = M.eventById(st, eventId);
  if (!ev) return { pool: 0, picked: [], considered: [], cap: 0 };
  const c = context(st, ev, phase, nonce, matchId);
  const all = possible(c);
  // the rest of this show's part (after its other matches, or after it): one show's limits, kinds and people across them
  const others = st.story.rolls.filter(r => r.event === ev.id && r.phase === phase && !r.undone && (r.match || null) !== (matchId || null));
  const slot = matchId ? `${phase}:${matchId}` : phase;
  // after an eventful episode of this show, the next one is calmer
  const prevEp = st.events.filter(e => e.showId === ev.showId && e.kind === ev.kind && M.compareStamps(st, e.at, ev.at) < 0)
    .sort((a, b) => M.compareStamps(st, b.at, a.at))[0];
  const busy = prevEp ? st.story.rolls.filter(r => r.event === prevEp.id && !r.undone).reduce((n, r) => n + r.considered.filter(k => k.picked).length, 0) : 0;
  if (busy >= 2) all.forEach(k => { k.chance *= RULES.calmFactor; why(k, 1, `Less likely: the last ${prevEp.name} was eventful`); });
  const thisWeek = c.picks.filter(p => p.wk === c.wk).length;
  const already = others.reduce((n, r) => n + r.considered.filter(k => k.picked).length, 0);
  const cap = Math.max(0, Math.min(c.pace[phase] - already, c.pace.perWeek - thisWeek));
  const passed = [];
  all.forEach(k => {
    k.roll = draw(c.seed, ev.id, slot, nonce, k.key);
    if (k.roll >= k.chance) return;
    if (k.kind === 'attack' && k.extra && draw(c.seed, ev.id, slot, nonce, k.key, 'save') < k.extra.chance) {
      k.kind = 'save';
      k.plan = { incidents: [...k.plan.incidents, k.extra.save] };
      k.people = [...k.people, k.extra.saver];
      k.extra.reasons.forEach(r => why(k, 1, r));
    }
    passed.push(k);
  });
  // everything that came up has an equal shot at the show's places
  passed.sort((a, b) => a.roll / a.chance - b.roll / b.chance);
  const family = kind => (kind === 'save' ? 'attack' : kind === 'cooling' || kind === 'respect' ? 'truce' : kind);
  const picked = [];
  const kinds = new Set(others.flatMap(r => r.considered.filter(k => k.picked).map(k => family(k.kind))));
  const used = new Set(ev.incidents.filter(x => others.some(r => r.made.includes(x.id))).flatMap(x => [...x.by, ...x.on, ...x.helped]));
  for (const k of passed) {
    if (picked.length >= cap) break;
    const fam = family(k.kind);
    if (kinds.has(fam) || k.people.some(id => used.has(id))) continue;
    kinds.add(fam);
    k.people.forEach(id => used.add(id));
    k.picked = true;
    picked.push({ kind: k.kind, key: k.key, plan: k.plan, why: k.factors.map(f => f.text), chance: k.chance, draw: k.roll, basis: k.basis, shock: k.shock });
  }
  // the log: every possibility, its chance and its draw - a shock remembered as one, so the next can't come too soon
  const considered = all.map(k => ({ kind: k.kind, key: k.key, chance: k.chance, draw: k.roll, picked: !!k.picked, shock: k.shock }))
    .sort((a, b) => b.picked - a.picked || b.chance - a.chance);
  return { pool: all.length, picked, considered, cap };
}

// ================================================================ keeping up

/**
 * What the director still has to do, in calendar order: after each recent
 * show whose results are in (its card complete, or its week gone by), and
 * before the next show up - the earliest this week without results - once
 * everything before it has been through. Only shows from the last
 * RULES.window weeks of the current season, and none before `story.since`.
 */
export function due(st) {
  if (!st.story.on) return [];
  const s = M.activeSeason(st);
  const since = st.story.since;
  const inScope = e => e.at.season === s.id && e.at.week <= s.week && e.at.week >= s.week - RULES.window
    && !(since && since.season === s.id && e.at.week < since.week);
  const evs = st.events.filter(inScope).sort((a, b) => M.compareStamps(st, a.at, b.at));
  const out = [];
  const played = e => e.matches.some(m => m.status === 'played');
  evs.forEach(e => {
    if (!played(e)) return;
    const whole = M.directorRollOf(st, e.id, 'post');
    if (whole && !st.story.rolls.some(r => r.event === e.id && r.match)) return;   // gone through as a whole, the old way: done
    // straight after each match, as soon as its result is in - in card order, and for one added later too
    e.matches.forEach(m => { if (m.status === 'played' && !M.directorRollOf(st, e.id, 'post', m.id)) out.push({ event: e, phase: 'post', match: m }); });
    // and once the card is complete, or its week is over, what wasn't about one match
    if (!whole && (M.cardStatus(e).state === 'complete' || e.at.week < s.week)) out.push({ event: e, phase: 'post', match: null });
  });
  const next = evs.find(e => e.at.week === s.week && !played(e));
  if (next && !M.directorRollOf(st, next.id, 'pre')
    && evs.filter(e => M.compareStamps(st, e.at, next.at) < 0 && played(e)).every(e => M.directorRollOf(st, e.id, 'post'))) {
    out.push({ event: next, phase: 'pre', match: null });
  }
  return out;
}

/**
 * Catch the director up: run everything due, one at a time (each run sees
 * what the last one did). `seed` seeds a save that has none yet - the app
 * passes a random one; the model never rolls. Returns the runs made.
 */
export function tick(st, { seed = null } = {}) {
  if (!st.story.on) return [];
  if (seed != null) M.seedStory(st, seed);
  if (!st.story.seed) return [];
  const runs = [];
  for (let guard = 0; guard < 400; guard++) {
    const d = due(st)[0];
    if (!d) break;
    const match = d.match ? d.match.id : null;
    const r = lookAt(st, d.event.id, d.phase, 0, match);
    try {
      runs.push(M.saveDirectorRoll(st, d.event.id, d.phase, r, { nonce: 0, match }));
    } catch (e) {
      if (!(e instanceof M.UniverseError)) throw e;
      // what it picked couldn't be recorded: log the run with nothing made, and why - so it can be looked into, and
      // nothing after it is held up
      const none = { ...r, picked: [], considered: r.considered.map(k => ({ ...k, picked: false })) };
      runs.push(M.saveDirectorRoll(st, d.event.id, d.phase, none, { nonce: 0, problem: e.message, match }));
    }
  }
  return runs;
}

/**
 * Run a show's part again - the owner's call, when they'd like the story
 * different: whatever the last run did is undone, and the director goes
 * again with the next nonce, so the new outcome is just as reproducible.
 */
export function rerun(st, rollId) {
  const old = M.rollById(st, rollId);
  if (!old) throw new M.UniverseError('That story director run isn\'t on record.');
  if (!old.undone) M.undoDirectorRoll(st, rollId);
  const match = old.match || null;
  const nonce = Math.max(...st.story.rolls.filter(r => r.event === old.event && r.phase === old.phase && (r.match || null) === match).map(r => r.nonce)) + 1;
  const r = lookAt(st, old.event, old.phase, nonce, match);
  return M.saveDirectorRoll(st, old.event, old.phase, r, { nonce, match });
}

/** Everyone who could challenge for a title after a show, with their share of the draw. */
export function titleContenders(st, eventId, titleId) {
  const ev = M.eventById(st, eventId), t = M.titleById(st, titleId);
  const reign = t && M.currentReign(st, t.id);
  if (!ev || !reign) return [];
  const c = context(st, ev, 'post', 0);
  const list = contendersOf(c, t, reign, titleShow(c, t, reign));
  const total = list.reduce((n, k) => n + k.w, 0);
  return list.map(k => ({ ...k, share: k.w / total }));
}
