// Universe — the story engine: what might happen after a show.
//
// Nothing here changes the universe. Once a show has results, this reads the
// record - the results, personalities, relationships, champions, teams and
// who has been getting booked - and weighs what could plausibly happen next:
// a post-match attack, a surprise save, a betrayal, a rivalry boiling over, a
// title challenge, a team splitting up, an unlikely winning streak, someone
// demanding a chance. Every possibility gets a chance and its reasons, and a
// seeded draw - the same every time for the same universe, so looking again
// never rerolls - decides which come up. What comes up is only a suggestion
// until the owner accepts it (model.js), and none of it is ever a result: WWE
// 2K25 decides those.
//
// Keeping it rare and fresh:
//   - every chance starts small, and the pace (quiet / normal / wild) scales it
//   - anyone in something in the last RULES.recentWeeks weeks is less likely
//     to be in something again
//   - the same thing between the same people won't come up again for
//     RULES.repeatWeeks weeks, nor anything dismissed for RULES.dismissedWeeks
//   - after an eventful episode of a show, its next one is calmer
//   - each show and each week has a limit, and a show never gets two of a kind
//     or one wrestler in two suggestions
// Title challenges pick from everyone eligible, weighted but never ranked out,
// so the least likely contender can always come up.
import * as M from './model.js';
import * as RL from './relations.js';

export const PACE = {
  quiet: { label: 'Quiet', mult: 0.5, perShow: 1, perWeek: 2, text: 'Once in a while — most shows pass without anything.' },
  normal: { label: 'Normal', mult: 1, perShow: 2, perWeek: 3, text: 'Now and then — something after roughly one show in three.' },
  wild: { label: 'Wild', mult: 2, perShow: 3, perWeek: 6, text: 'Often — something after about every other show. Chaos, within limits.' },
};
export const KIND = {
  attack: { label: 'Post-match attack', base: 0.025, color: '#FF5A4E' },
  save: { label: 'Surprise save', base: 0.35, color: '#4CD37A' },          // once an attack happens
  betrayal: { label: 'Betrayal', base: 0.02, color: '#FF5A4E' },
  escalation: { label: 'Rivalry escalation', base: 0.012, color: '#F0A53A' },
  challenge: { label: 'Title challenge', base: 0.06, color: '#E8B931' },
  breakup: { label: 'Team breakup', base: 0.012, color: '#98A3B3' },
  streak: { label: 'Unlikely winning streak', base: 0.15, color: '#72C4FF' },
  demand: { label: 'Demands an opportunity', base: 0.008, color: '#C9A7FF' },
};
export const RULES = { recentWeeks: 2, recentFactor: 0.4, repeatWeeks: 6, dismissedWeeks: 10, calmFactor: 0.6, maxChance: 0.85,
  streakMin: 3, quietTitleWeeks: 4 };

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
function weekNo(st, stamp) {
  let n = 0;
  for (const s of [...st.seasons].sort((a, b) => a.number - b.number)) {
    if (s.id === stamp.season) return n + stamp.week;
    n += s.status === 'active' ? s.week : s.ended.week;
  }
  return n + stamp.week;
}

const pct = x => `${Math.round(x * 100)}%`;
const times = n => `${n} time${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------- what the engine knows about a show

function context(st, ev) {
  const d = RL.relationships(st);
  const wk = weekNo(st, ev.at);
  const upTo = e => M.compareStamps(st, e.at, ev.at) <= 0;
  // every played match up to and including this show, oldest first
  const played = st.events.filter(upTo).sort((a, b) => M.compareStamps(st, a.at, b.at))
    .flatMap(e => e.matches.filter(m => m.status === 'played').map(m => ({ ev: e, m, wk: weekNo(st, e.at) })));
  const hist = new Map();
  played.forEach(x => x.m.sides.forEach((sd, i) => sd.wrestlers.forEach(id => {
    if (!hist.has(id)) hist.set(id, []);
    hist.get(id).push({ ...x, side: i, res: M.resultFor(x.m, i) });
  })));
  const tonight = ev.matches.filter(m => m.status === 'played');
  const onCard = new Set(tonight.flatMap(m => m.sides.flatMap(sd => sd.wrestlers)));
  const incidents = M.allIncidents(st).filter(x => upTo(x.event)).map(x => ({ ...x, wk: weekNo(st, x.event.at) }));
  const others = st.story.suggestions.filter(sg => sg.event !== ev.id).map(sg => {
    const e = M.eventById(st, sg.event);
    return { sg, wk: e ? weekNo(st, e.at) : -99, show: e ? e.showId : null, e };
  });
  return { st, ev, d, wk, hist, tonight, onCard, incidents, others, seed: st.story.seed, pace: PACE[st.story.pace] };
}

const W = (c, id) => M.wrestlerById(c.st, id);
const nm = (c, id) => (W(c, id) || { name: '?' }).name;
const names = (c, ids) => ids.map(id => nm(c, id)).join(' & ');
const has = (c, id, trait) => (W(c, id) || { traits: [] }).traits.includes(trait);
const rel = (c, kind, a, b) => { const r = c.d.rels.get(RL.relKey(kind, a, b)); return r && r.active ? r : null; };
const heat = (c, a, b) => (rel(c, 'grudge', a, b) || { level: 0 }).level;
const winnersOf = m => (m.outcome === 'win' ? m.sides[m.winner].wrestlers : []);
// the run of results at the end of someone's record: { res, n }
function run(c, id) {
  const h = c.hist.get(id) || [];
  if (!h.length) return { res: null, n: 0 };
  const res = h[h.length - 1].res;
  let n = 0;
  for (let i = h.length - 1; i >= 0 && h[i].res === res; i--) n++;
  return { res, n };
}
// losses in a row to any of `ws` - counting only their meetings
function lossesTo(c, id, ws) {
  const h = (c.hist.get(id) || []).filter(x => x.m.sides.some((sd, i) => i !== x.side && sd.wrestlers.some(w => ws.includes(w))));
  let n = 0;
  for (let i = h.length - 1; i >= 0 && h[i].res === 'L'; i--) n++;
  return n;
}
const holders = (st, h) => (h.type === 'team' ? (M.teamById(st, h.id) || { members: [] }).members : [h.id]);
const fits = (w, t) => t.division === 'open' || (t.division === 'men') === (w.gender === 'male');

// A possibility: its chance is base x every factor x the pace, and each
// factor carries the sentence that explains it.
function candidate(c, kind, key, people) {
  return { kind, key, people, factors: [], plan: null, basis: {}, chance: 0, extra: null, prompt: null };
}
const why = (cand, factor, text) => { cand.factors.push({ factor, text }); };
const driven = cand => cand.factors.some(f => f.factor > 1);
const outOfNowhere = (cand, factor = 0.3) => { if (!driven(cand)) why(cand, factor, 'Nothing obvious behind it — this would come out of nowhere'); };

// less likely for anyone who's been in the thick of it lately, or for a
// repeat of the same thing; nothing the owner dismissed comes straight back
const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
function freshness(c, cand) {
  const p = cand.plan.incidents[0];
  if (c.ev.incidents.some(x => x.kind === p.kind && sameSet(x.by, p.by) && sameSet(x.on, p.on))) return false;
  const recent = new Set();
  c.incidents.filter(x => c.wk - x.wk < RULES.recentWeeks && x.wk <= c.wk && x.incident.id !== cand.prompt)
    .forEach(x => [...x.incident.by, ...x.incident.on, ...x.incident.helped].forEach(id => { if (cand.people.includes(id)) recent.add(id); }));
  c.others.filter(o => o.sg.status !== 'dismissed' && c.wk - o.wk < RULES.recentWeeks && o.wk <= c.wk)
    .forEach(o => o.sg.plan.incidents.forEach(i => [...i.by, ...i.on, ...i.helped].forEach(id => { if (cand.people.includes(id)) recent.add(id); })));
  if (recent.size) {
    why(cand, RULES.recentFactor ** Math.min(2, recent.size),
      `Less likely: ${names(c, [...recent])} ${recent.size === 1 ? 'was' : 'were'} in something in the last ${RULES.recentWeeks} weeks`);
  }
  const same = c.others.filter(o => o.sg.key === cand.key && c.wk - o.wk >= 0);
  if (same.some(o => o.sg.status === 'dismissed' && c.wk - o.wk < RULES.dismissedWeeks)) return false;
  if (same.some(o => o.sg.status !== 'dismissed' && c.wk - o.wk < RULES.repeatWeeks)) return false;
  return true;
}
function finish(c, cand, base) {
  let x = base * c.pace.mult;
  cand.factors.forEach(f => { x *= f.factor; });
  cand.chance = Math.min(RULES.maxChance, x);
  return cand;
}

// ---------------------------------------------------------------- the possibilities

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
        const h = Math.max(...Ws.map(w => heat(c, l, w)));
        if (h) why(cand, 1 + 0.7 * h, `${L} holds a grudge against ${V} (heat ${h})`);
        if (Ws.some(w => rel(c, 'rivals', l, w))) why(cand, 1.4, `${L} and ${V} are rivals`);
        if (reign) why(cand, 2.5, `${L} just lost the ${M.titleById(c.st, reign.titleId).name}`);
        const n = lossesTo(c, l, Ws);
        if (n >= 2) why(cand, 1 + 0.35 * n, `${L} has lost ${n} straight to ${V}`);
        outOfNowhere(cand);
        if (Ws.some(w => rel(c, 'friends', l, w))) why(cand, 0.15, `Less likely: ${L} and ${V} are friends`);
        else if (Ws.some(w => rel(c, 'allies', l, w))) why(cand, 0.4, `Less likely: ${L} and ${V} are allies`);
        cand.plan = { incidents: [{ kind: 'attack', by: [l], on: [...Ws], helped: [], match: m.id }] };
        cand.basis = { match: m.id, winners: Ws };
        if (!freshness(c, cand)) return;
        cand.extra = saverFor(c, l, Ws, m.id);
        best.push(finish(c, cand, KIND.attack.base));
      });
    });
    const top = best.sort((a, b) => b.chance - a.chance)[0];      // one would-be attacker per match
    if (top) out.push(top);
  });
  return out;
}

// who'd run in to save the victims from an attacker - the strongest bond wins
function saverFor(c, attacker, victims, matchId) {
  const ev = c.ev;
  const pool = c.st.wrestlers.filter(z => z.status !== 'injured' && z.id !== attacker && !victims.includes(z.id)
    && (c.onCard.has(z.id) || !ev.showId || z.showId === ev.showId));
  let best = null;
  pool.forEach(z => {
    const reasons = [];
    let w = 0;
    victims.forEach(v => {
      const Z = z.name, V = nm(c, v);
      if (rel(c, 'friends', z.id, v)) { w += 3; reasons.push(`${Z} and ${V} are friends`); }
      else if (rel(c, 'allies', z.id, v)) { w += 2.2; reasons.push(`${Z} and ${V} are allies`); }
      if (c.st.teams.some(t => t.active && t.members.includes(z.id) && t.members.includes(v))) { w += 2; reasons.push(`${Z} teams with ${V}`); }
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

// an attack already on record at this show that nobody has answered yet
function savesForRecorded(c) {
  const out = [];
  c.ev.incidents.filter(x => x.kind === 'attack').forEach(x => {
    if (c.ev.incidents.some(y => y.kind === 'save' && y.on.some(id => x.by.includes(id)))) return;
    const attacker = x.by[0];
    const s = saverFor(c, attacker, x.on, x.match);
    if (!s) return;
    const cand = candidate(c, 'save', `save:${s.saver}>${attacker}`, [s.saver, attacker, ...x.on]);
    why(cand, 1, `${nm(c, attacker)} attacked ${names(c, x.on)} at ${c.ev.name}`);
    s.reasons.forEach(t => why(cand, 1, t));
    cand.prompt = x.id;
    cand.plan = { incidents: [s.save] };
    cand.basis = x.match ? { match: x.match, winners: winnersOf(c.ev.matches.find(m => m.id === x.match) || {}) } : {};
    if (!freshness(c, cand)) return;
    out.push(finish(c, cand, s.chance / c.pace.mult * 0.7));
  });
  return out;
}

function betrayals(c) {
  const out = [];
  c.tonight.forEach(m => m.sides.forEach((sd, i) => {
    if (sd.wrestlers.length < 2) return;
    const res = M.resultFor(m, i);
    const best = [];
    sd.wrestlers.forEach(x => sd.wrestlers.forEach(y => {
      if (x === y) return;
      const cand = candidate(c, 'betrayal', `betrayal:${x}>${y}`, [x, y]);
      const X = nm(c, x), Y = nm(c, y);
      why(cand, 1, `${X} teamed with ${Y} at ${c.ev.name}`);
      if (res === 'L') why(cand, 1.6, `They just lost together`);
      if (has(c, x, 'opportunistic')) why(cand, 3, `${X} is opportunistic`);
      if (has(c, x, 'ambitious')) why(cand, 1.5, `${X} is ambitious`);
      const theirs = c.st.titles.filter(t => { const r = M.currentReign(c.st, t.id); return r && holders(c.st, r.holder).includes(y) && !holders(c.st, r.holder).includes(x); });
      if (theirs.length && has(c, x, 'ambitious')) why(cand, 1.5, `${Y} holds the ${theirs[0].name}`);
      const h = heat(c, x, y);
      if (h) why(cand, 1 + h, `${X} already holds a grudge against ${Y} (heat ${h})`);
      const together = (c.hist.get(x) || []).filter(e => e.m.sides[e.side].wrestlers.includes(y)).slice(-4);
      const lost = together.filter(e => e.res === 'L').length;
      if (lost >= 2) why(cand, 1 + 0.3 * lost, `They've lost ${lost} of their last ${together.length} together`);
      outOfNowhere(cand, 0.25);
      if (has(c, x, 'loyal')) why(cand, 0.15, `Less likely: ${X} is loyal`);
      if (has(c, x, 'respectful')) why(cand, 0.5, `Less likely: ${X} is respectful`);
      if (rel(c, 'friends', x, y)) why(cand, 0.5, `Less likely: ${X} and ${Y} are friends`);
      cand.plan = { incidents: [{ kind: 'betrayal', by: [x], on: [y], helped: [], match: m.id }] };
      cand.basis = { match: m.id, winners: winnersOf(m) };
      if (!freshness(c, cand)) return;
      best.push(finish(c, cand, KIND.betrayal.base));
    }));
    const top = best.sort((a, b) => b.chance - a.chance)[0];
    if (top) out.push(top);
  }));
  return out;
}

function escalations(c) {
  const out = [];
  const ids = [...c.onCard].sort();
  const together = (a, b) => c.tonight.find(m => m.sides.some(sd => sd.wrestlers.includes(a)) && m.sides.some(sd => sd.wrestlers.includes(b)));
  ids.forEach((a, i) => ids.slice(i + 1).forEach(b => {
    const rv = rel(c, 'rivals', a, b), ha = heat(c, a, b), hb = heat(c, b, a);
    const bad = (rv ? rv.level : 0) + ha + hb;
    const m = together(a, b);
    if (!bad || (!m && bad < 3)) return;                // it boils over in the ring, or where the bad blood runs deep
    const [x, y] = ha >= hb ? [a, b] : [b, a];
    const cand = candidate(c, 'escalation', `escalation:${a}+${b}`, [a, b]);
    const A = nm(c, a), B = nm(c, b);
    if (rv) why(cand, 1, `${A} and ${B} are rivals (heat ${rv.level})`);
    if (ha) why(cand, 1, `${A} holds a grudge against ${B} (heat ${ha})`);
    if (hb) why(cand, 1, `${B} holds a grudge against ${A} (heat ${hb})`);
    why(cand, 1 + 0.3 * bad, bad >= 4 ? 'There’s a lot of bad blood between them' : 'There’s bad blood between them');
    if (m) why(cand, 1.6, `They were in the same match tonight`);
    else why(cand, 1, `Both were at ${c.ev.name}`);
    if (has(c, a, 'hot-headed') || has(c, b, 'hot-headed')) why(cand, 1.4, `${has(c, a, 'hot-headed') ? A : B} is hot-headed`);
    cand.plan = { incidents: [{ kind: 'brawl', by: [x], on: [y], helped: [], match: m ? m.id : null }] };
    cand.basis = m ? { match: m.id, winners: winnersOf(m) } : {};
    if (!freshness(c, cand)) return;
    out.push(finish(c, cand, KIND.escalation.base));
  }));
  return out;
}

// everyone who could step up for a title, weighted - nobody is ranked out
function contendersOf(c, t, reign, showId) {
  const st = c.st;
  const champs = holders(st, reign.holder);
  const champName = M.holderName(st, reign.holder);
  const pool = t.kind === 'tag'
    ? st.teams.filter(tm => tm.active && tm.id !== reign.holder.id && !tm.members.some(id => champs.includes(id))
      && tm.members.every(id => { const w = W(c, id); return w && w.showId === showId && w.status !== 'injured' && fits(w, t); }))
      .map(tm => ({ ids: [...tm.members], name: tm.name, team: tm.id }))
    : st.wrestlers.filter(w => w.showId === showId && w.status !== 'injured' && !champs.includes(w.id) && fits(w, t))
      .map(w => ({ ids: [w.id], name: w.name }));
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
    const r = run(c, lead);
    if (r.res === 'W' && r.n >= 2) { w += 0.5 * r.n; reasons.push(`${k.name} has won ${r.n} straight`); }
    const lately = kind => c.incidents.some(x => x.incident.kind === kind && x.incident.by.some(id => k.ids.includes(id)) && c.wk - x.wk < RULES.repeatWeeks);
    if (lately('momentum')) { w += 2; reasons.push(`${k.name}'s unlikely run has everyone talking`); }
    if (lately('demand')) { w += 1.5; reasons.push(`${k.name} demanded an opportunity recently`); }
    if (c.tonight.some(m => m.outcome === 'win' && winnersOf(m).includes(lead))) { w += 0.7; reasons.push(`${k.name} won tonight`); }
    if (k.ids.some(x => has(c, x, 'ambitious'))) { w *= 1.5; reasons.push(`${k.name} ${k.ids.length > 1 ? 'have' : 'is'} ambition`); }
    return { ...k, w, reasons };
  });
}

function challenges(c) {
  const st = c.st, out = [];
  st.titles.filter(t => t.active).forEach(t => {
    const reign = M.currentReign(st, t.id);
    if (!reign) return;
    const champs = holders(st, reign.holder);
    const champAppeared = champs.some(id => c.onCard.has(id));
    const showId = t.showId || (W(c, champs[0]) || {}).showId;
    if (!champAppeared && c.ev.showId && showId !== c.ev.showId) return;
    const champName = M.holderName(st, reign.holder);
    const contenders = contendersOf(c, t, reign, showId);
    if (!contenders.length) return;
    const total = contenders.reduce((n, k) => n + k.w, 0);
    // a weighted pick, not the top of a table: the outsider can always come up
    let x = draw(c.seed, c.ev.id, 'contender', t.id) * total;
    const pick = contenders.find(k => (x -= k.w) < 0) || contenders[contenders.length - 1];
    const cand = candidate(c, 'challenge', `challenge:${t.id}:${[...pick.ids].sort().join('+')}`, [...pick.ids, ...champs]);
    why(cand, 1, `${champName} ${champs.length > 1 ? 'hold' : 'holds'} the ${t.name}`);
    if (champAppeared) why(cand, 1.4, `${champName} wrestled at ${c.ev.name}`);
    const lastTitleMatch = st.events.filter(e => e.matches.some(m => m.status === 'played' && m.titleId === t.id)).map(e => weekNo(st, e.at))
      .filter(n => n <= c.wk).sort((a, b) => b - a)[0];
    const quiet = lastTitleMatch == null ? c.wk - weekNo(st, reign.start) : c.wk - lastTitleMatch;
    if (quiet >= RULES.quietTitleWeeks) why(cand, 1.5, `The ${t.name} hasn't been on the line in ${quiet} weeks`);
    pick.reasons.forEach(r => why(cand, 1, r));
    why(cand, 1, `${pick.name} came up from ${contenders.length} possible challenger${contenders.length === 1 ? '' : 's'} — anyone eligible can, and the rankings don't decide it (${pct(pick.w / total)} of the draw)`);
    if (weekNo(st, reign.start) >= c.wk - 1) why(cand, 0.5, `Less likely: ${champName} only just won it`);
    cand.plan = { incidents: [{ kind: 'challenge', by: [...pick.ids], on: [...champs], helped: [], title: t.id }] };
    cand.basis = { title: { id: t.id, holder: reign.holder } };
    if (!freshness(c, cand)) return;
    out.push(finish(c, cand, KIND.challenge.base));
  });
  return out;
}

/** Everyone who could challenge for a title after a show, with their share of the draw. */
export function titleContenders(st, eventId, titleId) {
  const ev = M.eventById(st, eventId), t = M.titleById(st, titleId);
  const reign = t && M.currentReign(st, t.id);
  if (!ev || !reign) return [];
  const c = context(st, ev);
  const list = contendersOf(c, t, reign, t.showId || (M.wrestlerById(st, holders(st, reign.holder)[0]) || {}).showId);
  const total = list.reduce((n, k) => n + k.w, 0);
  return list.map(k => ({ ...k, share: k.w / total }));
}

function breakups(c) {
  const st = c.st, out = [];
  st.teams.filter(t => t.active && t.members.some(id => c.onCard.has(id))).forEach(t => {
    if (M.titlesHeldBy(st, { type: 'team', id: t.id }).length) return;       // champions don't split mid-reign
    const cand = candidate(c, 'breakup', `breakup:${t.id}`, [...t.members]);
    const results = M.teamMatches(st, t.id).filter(x => M.compareStamps(st, x.event.at, c.ev.at) <= 0);
    why(cand, 1, `${t.name} were at ${c.ev.name}`);
    const tonight = results.find(x => x.event.id === c.ev.id);
    if (tonight && M.resultFor(tonight.match, tonight.side) === 'L') why(cand, 1.6, `${t.name} lost tonight`);
    const last4 = results.slice(0, 4), lost = last4.filter(x => M.resultFor(x.match, x.side) === 'L').length;
    if (lost >= 3) why(cand, 2, `${t.name} have lost ${lost} of their last ${last4.length}`);
    let walker = null, walkerScore = 0;
    t.members.forEach(x => {
      let s = 0;
      const X = nm(c, x);
      t.members.forEach(y => {
        const h = x !== y && heat(c, x, y);
        if (h) { why(cand, 1 + h, `${X} holds a grudge against ${nm(c, y)} (heat ${h})`); s += 2 * h; }
      });
      if (has(c, x, 'opportunistic')) { why(cand, 2, `${X} is opportunistic`); s += 2; }
      if (has(c, x, 'ambitious')) { why(cand, 1.4, `${X} is ambitious`); s += 1; }
      if (has(c, x, 'loyal')) why(cand, 0.5, `Less likely: ${X} is loyal`);
      if (s > walkerScore) { walker = x; walkerScore = s; }
    });
    if (!walker && lost < 3) return;                     // a team splits over something: bad blood, ambition, or losing
    if (t.members.some((x, i) => t.members.slice(i + 1).some(y => rel(c, 'friends', x, y)))) why(cand, 0.4, `Less likely: there are friends in ${t.name}`);
    const others = t.members.filter(x => x !== walker);
    cand.plan = { incidents: [{ kind: 'breakup', by: walker ? [walker] : [...t.members], on: walker ? others : [], helped: [], team: t.id,
      match: tonight ? tonight.match.id : null }], disband: t.id };
    cand.basis = { team: t.id };
    if (!freshness(c, cand)) return;
    out.push(finish(c, cand, KIND.breakup.base));
  });
  return out;
}

function streaks(c) {
  const out = [];
  c.tonight.forEach(m => winnersOf(m).forEach(id => {
    const r = run(c, id);
    if (r.res !== 'W' || r.n < RULES.streakMin) return;
    const before = (c.hist.get(id) || []).slice(0, -r.n).slice(-10);
    const w = before.filter(x => x.res === 'W').length, l = before.filter(x => x.res === 'L').length;
    if (before.length < 3 || w / before.length >= 0.45) return;                // only an unlikely run
    const cand = candidate(c, 'streak', `streak:${id}`, [id]);
    why(cand, 1 + 0.25 * (r.n - RULES.streakMin), `${nm(c, id)} has won ${r.n} straight`);
    why(cand, 1, `Before this run: ${w} win${w === 1 ? '' : 's'} and ${l} loss${l === 1 ? '' : 'es'} in their last ${before.length}`);
    cand.plan = { incidents: [{ kind: 'momentum', by: [id], on: [], helped: [], match: m.id }] };
    cand.basis = { match: m.id, winners: winnersOf(m) };
    if (!freshness(c, cand)) return;
    out.push(finish(c, cand, KIND.streak.base));
  }));
  return out;
}

function demands(c) {
  const st = c.st, out = [];
  if (!c.ev.showId) return out;                                       // an all-shows PLE: nobody's own show
  const roster = st.wrestlers.filter(w => w.showId === c.ev.showId && w.status !== 'injured');
  const count = id => (c.hist.get(id) || []).filter(x => c.wk - x.wk < 4).length;
  const byDiv = g => roster.filter(w => w.gender === g).map(w => count(w.id)).sort((a, b) => a - b);
  roster.forEach(w => {
    const counts = byDiv(w.gender), typical = counts.length >= 3 ? counts[counts.length >> 1] : null;
    const mine = count(w.id), r = run(c, w.id);
    const underbooked = typical != null && typical >= 2 && mine <= typical / 2;
    const winning = r.res === 'W' && r.n >= 2 && c.onCard.has(w.id);
    const driven = w.traits.includes('ambitious') || w.traits.includes('proud');
    if (!underbooked && !(winning && driven)) return;
    const cand = candidate(c, 'demand', `demand:${w.id}`, [w.id]);
    if (underbooked) why(cand, 3, `${w.name} has had ${times(mine)} in 4 weeks — ${typical} is typical on ${M.showById(st, c.ev.showId).name}`);
    if (winning) why(cand, 1.5, `${w.name} has won ${r.n} straight`);
    if (w.traits.includes('ambitious')) why(cand, 2, `${w.name} is ambitious`);
    if (w.traits.includes('proud')) why(cand, 1.5, `${w.name} is proud`);
    if (w.traits.includes('patient')) why(cand, 0.4, `Less likely: ${w.name} is patient`);
    if (w.traits.includes('cowardly')) why(cand, 0.5, `Less likely: ${w.name} is cowardly`);
    // winning, or hungry for gold: the demand is for the title in their division on their show
    const t = (winning || w.traits.includes('ambitious')) && st.titles.find(x => x.active && x.kind === 'singles' && x.showId === w.showId && fits(w, x)
      && M.currentReign(st, x.id) && !holders(st, M.currentReign(st, x.id).holder).includes(w.id));
    const reign = t && M.currentReign(st, t.id);
    cand.plan = { incidents: [{ kind: 'demand', by: [w.id], on: reign ? holders(st, reign.holder) : [], helped: [], title: t ? t.id : null }] };
    cand.basis = reign ? { title: { id: t.id, holder: reign.holder } } : {};
    if (!freshness(c, cand)) return;
    out.push(finish(c, cand, KIND.demand.base));
  });
  return out;
}

// ---------------------------------------------------------------- looking at a show

/**
 * Everything that could happen after a show, and what comes up.
 * Returns { pool, found, considered, cap }: `considered` is every possibility
 * with its chance and reasons; `found` the drafts that came up, ready for
 * model.saveStoryRoll - { kind, key, plan, why, chance, basis }.
 */
export function lookAt(st, eventId) {
  const ev = M.eventById(st, eventId);
  if (!ev || !ev.matches.some(m => m.status === 'played')) return { pool: 0, found: [], considered: [], cap: 0 };
  const c = context(st, ev);
  const considered = [...attacks(c), ...savesForRecorded(c), ...betrayals(c), ...escalations(c), ...challenges(c), ...breakups(c),
    ...streaks(c), ...demands(c)];
  // after an eventful episode of this show, the next one is calmer
  const prev = c.others.filter(o => o.e && o.show === ev.showId && M.compareStamps(st, o.e.at, ev.at) < 0 && o.sg.status !== 'dismissed');
  const lastEv = prev.map(o => o.e).sort((a, b) => M.compareStamps(st, b.at, a.at))[0];
  if (lastEv && prev.filter(o => o.e === lastEv).length >= 2) {
    considered.forEach(k => { k.chance *= RULES.calmFactor; why(k, 1, `Less likely: the last ${lastEv.name} was eventful`); });
  }
  const thisWeek = c.others.filter(o => o.wk === c.wk && o.sg.status !== 'dismissed').length;
  const cap = Math.max(0, Math.min(c.pace.perShow, c.pace.perWeek - thisWeek));
  const passed = [];
  considered.forEach(k => {
    k.roll = draw(c.seed, ev.id, k.key);
    if (k.roll >= k.chance) return;
    // an attack can bring a save with it
    if (k.kind === 'attack' && k.extra && draw(c.seed, ev.id, k.key, 'save') < k.extra.chance) {
      k.kind = 'save';
      k.plan = { incidents: [...k.plan.incidents, k.extra.save] };
      k.people = [...k.people, k.extra.saver];
      k.extra.reasons.forEach(r => why(k, 1, r));
      k.chance *= k.extra.chance;
    }
    passed.push(k);
  });
  // everything that came up has an equal shot at the show's places
  passed.sort((a, b) => a.roll / a.chance - b.roll / b.chance);
  const found = [], used = new Set(), kinds = new Set();
  for (const k of passed) {
    if (found.length >= cap) break;
    if (kinds.has(k.kind) || k.people.some(id => used.has(id))) continue;
    kinds.add(k.kind);
    k.people.forEach(id => used.add(id));
    found.push({ kind: k.kind, key: k.key, plan: k.plan, why: k.factors.map(f => f.text), chance: k.chance, basis: k.basis });
  }
  return { pool: considered.length, found, considered, cap };
}

// ---------------------------------------------------------------- in words

/** A suggestion's headline, from its plan: "Gunther attacks Jey Uso after the match". */
export function headline(st, sg) {
  const [a, b] = sg.plan.incidents;
  const n = ids => ids.map(id => (M.wrestlerById(st, id) || { name: '?' }).name).join(' & ');
  const title = id => (M.titleById(st, id) || { name: 'title' }).name;
  switch (sg.kind) {
    case 'attack': return `${n(a.by)} attacks ${n(a.on)}${a.match ? ' after the match' : ''}`;
    case 'save': return b ? `${n(a.by)} attacks ${n(a.on)} — until ${n(b.by)} makes the save` : `${n(a.by)} runs in to save ${n(a.helped)} from ${n(a.on)}`;
    case 'betrayal': return `${n(a.by)} turns on ${n(a.on)}`;
    case 'escalation': return `${n(a.by)} and ${n(a.on)} brawl — the rivalry boils over`;
    case 'challenge': return `${n(a.by)} challenge${a.by.length > 1 ? '' : 's'} ${n(a.on)} for the ${title(a.title)}`;
    case 'breakup': {
      const team = (M.teamById(st, a.team) || { name: 'The team' }).name;
      return a.on.length ? `${n(a.by)} walks out on ${n(a.on)} — ${team} are finished` : `${team} go their separate ways`;
    }
    case 'streak': return `${n(a.by)} is on an unlikely winning streak`;
    case 'demand': return a.title ? `${n(a.by)} demands a shot at the ${title(a.title)}` : `${n(a.by)} demands an opportunity`;
    default: return '';
  }
}

/** How likely it was, in words. */
export function oddsText(chance) {
  if (chance < 0.05) return `a long shot (${chance < 0.01 ? 'under 1%' : pct(chance)})`;
  if (chance < 0.15) return `rare (${pct(chance)})`;
  if (chance < 0.35) return `uncommon (${pct(chance)})`;
  return `likely (${pct(chance)})`;
}
