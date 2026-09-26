// Universe — relationships, worked out from the record.
//
// Nothing here is stored. Every relationship - a grudge, a rivalry, an
// alliance, a friendship, former partners - is replayed from what's on
// record, in calendar order: results, title changes, team history, the
// incidents logged on shows, and the owner's own edits. So correcting a
// result corrects whatever grew out of it, and every relationship can show
// exactly why it exists.
//
// The rules, each shown in the app (How relationships work):
//   Losses        losing to the same wrestler 3 times running (no win over
//                 them in between) - a grudge against them, or 1 more heat.
//                 Hot-headed: 2 times. Patient: 4.
//   Title defeat  losing a title to someone in a match - a grudge against the
//                 new champion (ambitious: 2 heat), and they're rivals.
//   Betrayal      a grudge against the betrayer, 2 heat (loyal: 3); any
//                 friendship or alliance between them ends.
//   Interference  a grudge against whoever interfered against them; whoever
//                 it helped becomes their ally.
//   Attack        a grudge against the attacker (hot-headed: 2 heat).
//   Partnership   5 matches on the same side - allies (loyal: 3); 12 -
//                 friends (never for the opportunistic, or with a grudge
//                 between them).
//   Split         leaving a team, or it disbanding - former partners.
// Heat and strength run 1-3. Traits count as they were at the time; the
// app never changes a trait.
import { compareStamps, eventById, teamById, titleById, wrestlerById } from './model.js';

export const RULES = { streak: 3, streakHotHeaded: 2, streakPatient: 4, allies: 5, alliesLoyal: 3, friends: 12 };
export const KIND_LABEL = { grudge: 'Grudge', rivals: 'Rivals', allies: 'Allies', friends: 'Friends', 'former-partners': 'Former partners' };
const LEVEL_WORD = { grudge: 'heat', rivals: 'heat', allies: 'strength', friends: 'strength' };

const pairOf = (a, b) => (a < b ? `${a}+${b}` : `${b}+${a}`);
export const relKey = (kind, a, b) => (kind === 'grudge' ? `grudge:${a}>${b}` : `${kind}:${pairOf(a, b)}`);
const nth = n => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;

/**
 * Replay everything. Returns { rels, entries, streak, together, traitsOn }:
 *   rels     Map relKey -> { key, kind, a, b, active, level, since, entries }
 *            (a grudge: a holds it against b; the rest: a and b in id order)
 *   entries  every change in order: { key, rel, kind, a, b, at, change, level,
 *            auto, ignored, cause } - change is formed | raised | fuelled |
 *            set | ended | note | nothing (an end with nothing to end)
 */
export function relationships(st) {
  const rels = new Map();
  const entries = [];
  const dismissed = new Map(st.relEdits.filter(e => e.action === 'dismiss').map(e => [e.key, e]));
  const streak = new Map();                   // `${loser}>${winner}` -> losses in a row
  const together = new Map();                 // pair -> matches on the same side

  // traits as they were at a moment, from each wrestler's dated log
  const logs = new Map();
  st.traitLog.forEach(e => { if (!logs.has(e.wrestler)) logs.set(e.wrestler, []); logs.get(e.wrestler).push(e); });
  logs.forEach(list => list.sort((x, y) => (!x.at || !y.at ? !y.at - !x.at : compareStamps(st, x.at, y.at))));   // the start first
  const has = (wid, trait, at) => {
    let on = false;
    for (const e of logs.get(wid) || []) {                  // `at` null: as things stand now
      if (e.at && at && compareStamps(st, e.at, at) > 0) break;
      if (e.trait === trait) on = e.on;
    }
    return on;
  };

  const get = (kind, a, b) => {
    const key = relKey(kind, a, b);
    if (!rels.has(key)) {
      const [x, y] = kind === 'grudge' ? [a, b] : [a, b].sort();
      rels.set(key, { key, kind, a: x, b: y, active: false, level: 0, since: null, entries: [] });
    }
    return rels.get(key);
  };
  // what an operation would do to a relationship, without doing it
  const outcome = (r, op, amount) => {
    if (op === 'end') return r.active ? { active: false, level: 0, change: 'ended' } : null;
    if (op === 'form') return r.active ? null : { active: true, level: Math.max(1, amount), change: 'formed' };
    if (op === 'set') return { active: true, level: amount, change: r.active ? 'set' : 'formed' };
    if (!r.active) return { active: true, level: Math.min(3, amount), change: 'formed' };           // raise
    return r.level < 3 ? { active: true, level: Math.min(3, r.level + amount), change: 'raised' } : { active: true, level: 3, change: 'fuelled' };
  };
  const record = (r, next, at, extra) => {
    const e = { rel: r.key, kind: r.kind, a: r.a, b: r.b, at, change: next.change, level: next.level, ...extra };
    r.entries.push(e);
    entries.push(e);
    return e;
  };
  // an automatic change, unless the owner has had it ignored
  const auto = (kind, a, b, op, amount, cause) => {
    const r = get(kind, a, b);
    const next = outcome(r, op, amount);
    if (!next) return;
    const key = `${cause.key}|${r.key}`;
    const ignored = dismissed.get(key) || null;
    if (!ignored) {
      if (next.active && !r.active) r.since = cause.at;
      r.active = next.active;
      r.level = next.level;
    }
    record(r, next, cause.at, { key, auto: true, ignored, cause });
  };

  // ---- everything that can change a relationship, in calendar order
  const items = [];
  st.relEdits.filter(e => e.action !== 'dismiss').forEach(e => items.push({ at: e.at, order: 0, type: 'edit', e }));
  st.events.forEach(ev => {
    ev.matches.forEach((m, i) => { if (m.status === 'played') items.push({ at: ev.at, order: i + 1, type: 'match', ev, m }); });
    ev.incidents.forEach((inc, j) => items.push({ at: ev.at, order: 1000 + j, type: 'incident', ev, inc }));
  });
  st.memberships.forEach(ms => { if (ms.end) items.push({ at: ms.end, order: 0, type: 'left', ms }); });
  st.teams.forEach(t => t.log.forEach(l => { if (l.type === 'disbanded') items.push({ at: l.at, order: 0, type: 'disbanded', t, l }); }));
  items.sort((x, y) => (!x.at && !y.at ? 0 : !x.at ? -1 : !y.at ? 1 : compareStamps(st, x.at, y.at) || x.order - y.order));
  const reignOf = new Map(st.reigns.filter(r => r.matchId).map(r => [r.matchId, r]));

  for (const it of items) {
    if (it.type === 'edit') {
      const e = it.e;
      const r = get(e.kind, e.a, e.b);
      // an end with nothing left to end still shows, so it can be taken back
      const next = e.action === 'end' ? outcome(r, 'end') || { active: false, level: 0, change: 'nothing' }
        : e.action === 'note' ? { active: r.active, level: r.level, change: 'note' } : outcome(r, 'set', e.level);
      if (next.active && !r.active) r.since = e.at;
      r.active = next.active;
      r.level = next.level;
      record(r, next, e.at, { key: `edit:${e.id}`, auto: false, ignored: null, cause: { type: 'owner', edit: e, at: e.at } });
      continue;
    }
    if (it.type === 'match') {
      const { ev, m } = it;
      const base = { at: ev.at, event: ev.id, match: m.id };
      if (m.outcome === 'win') {
        const W = m.sides[m.winner].wrestlers;
        m.sides.forEach((sd, i) => {
          if (i === m.winner) return;
          sd.wrestlers.forEach(l => W.forEach(w => {
            streak.set(`${w}>${l}`, 0);
            const n = (streak.get(`${l}>${w}`) || 0) + 1;
            const need = has(l, 'hot-headed', ev.at) ? RULES.streakHotHeaded : has(l, 'patient', ev.at) ? RULES.streakPatient : RULES.streak;
            if (n >= need) {
              auto('grudge', l, w, 'raise', 1, { ...base, key: `loss:${m.id}:${l}>${w}`, type: 'losses', loser: l, winner: w, n });
              streak.set(`${l}>${w}`, 0);
            } else streak.set(`${l}>${w}`, n);
          }));
        });
        // a title lost in this match
        const reign = reignOf.get(m.id);
        const prev = reign && st.reigns.find(r => r.titleId === reign.titleId && r.end && r.end.seq === reign.start.seq);
        if (prev) {
          const held = sd => (prev.holder.type === 'team' ? sd.team === prev.holder.id : sd.wrestlers.includes(prev.holder.id));
          m.sides.forEach((sd, i) => {
            if (i === m.winner || !held(sd)) return;
            sd.wrestlers.forEach(l => W.forEach(w => {
              const cause = { ...base, key: `title:${reign.id}:${l}>${w}`, type: 'title', loser: l, winner: w, title: reign.titleId };
              auto('grudge', l, w, 'raise', has(l, 'ambitious', ev.at) ? 2 : 1, cause);
              auto('rivals', l, w, 'raise', 1, { ...cause, key: `title:${reign.id}:${pairOf(l, w)}` });
            }));
          });
        }
      }
      // partners: every pair on the same side, win or lose
      m.sides.forEach(sd => {
        const ids = sd.wrestlers;
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const [x, y] = [ids[i], ids[j]], p = pairOf(x, y);
            const n = (together.get(p) || 0) + 1;
            together.set(p, n);
            const loyal = has(x, 'loyal', ev.at) || has(y, 'loyal', ev.at);
            const cause = { ...base, type: 'partners', x, y, n };
            if (n === (loyal ? RULES.alliesLoyal : RULES.allies)) auto('allies', x, y, 'form', 1, { ...cause, key: `partners:${m.id}:${p}:allies` });
            const grudge = (get('grudge', x, y).active || get('grudge', y, x).active);
            const opportunist = has(x, 'opportunistic', ev.at) || has(y, 'opportunistic', ev.at);
            if (n === RULES.friends && !grudge && !opportunist) auto('friends', x, y, 'form', 1, { ...cause, key: `partners:${m.id}:${p}:friends` });
          }
        }
      });
      continue;
    }
    if (it.type === 'incident') {
      const { ev, inc } = it;
      const base = { at: ev.at, event: ev.id, match: inc.match, incident: inc.id, kind: inc.kind };
      inc.by.forEach(x => inc.on.forEach(y => {
        const cause = { ...base, key: `inc:${inc.id}:${y}>${x}`, type: inc.kind, by: x, on: y };
        if (inc.kind === 'betrayal') {
          auto('grudge', y, x, 'raise', has(y, 'loyal', ev.at) ? 3 : 2, cause);
          auto('friends', x, y, 'end', 0, cause);
          auto('allies', x, y, 'end', 0, cause);
        } else if (inc.kind === 'attack') {
          auto('grudge', y, x, 'raise', has(y, 'hot-headed', ev.at) ? 2 : 1, cause);
        } else auto('grudge', y, x, 'raise', 1, cause);
      }));
      if (inc.kind === 'interference') {
        inc.by.forEach(x => inc.helped.forEach(h => auto('allies', x, h, 'raise', 1,
          { ...base, key: `inc:${inc.id}:${x}>${h}:helped`, type: 'helped', by: x, helped: h })));
      }
      continue;
    }
    if (it.type === 'left') {
      const { ms } = it;
      st.memberships.filter(o => o.team === ms.team && o.wrestler !== ms.wrestler && compareStamps(st, o.start, ms.end) < 0
        && (!o.end || compareStamps(st, ms.start, o.end) < 0)).forEach(o => auto('former-partners', ms.wrestler, o.wrestler, 'form', 1,
        { at: ms.end, key: `left:${ms.id}:${pairOf(ms.wrestler, o.wrestler)}`, type: 'left', who: ms.wrestler, team: ms.team }));
      continue;
    }
    if (it.type === 'disbanded') {
      const { t, l } = it;
      const on = st.memberships.filter(o => o.team === t.id && compareStamps(st, o.start, l.at) <= 0 && (!o.end || compareStamps(st, o.end, l.at) > 0))
        .map(o => o.wrestler);
      for (let i = 0; i < on.length; i++) {
        for (let j = i + 1; j < on.length; j++) {
          auto('former-partners', on[i], on[j], 'form', 1, { at: l.at, key: `disband:${t.id}:${l.at.seq}:${pairOf(on[i], on[j])}`, type: 'disbanded', team: t.id });
        }
      }
    }
  }
  return { rels, entries, streak, together, has };
}

/** Relationships a wrestler is in now, strongest first. */
export function relationsOf(st, wid, derived = relationships(st)) {
  const order = { grudge: 0, rivals: 1, allies: 2, friends: 3, 'former-partners': 4 };
  return [...derived.rels.values()].filter(r => r.active && (r.a === wid || r.b === wid))
    .sort((x, y) => order[x.kind] - order[y.kind] || y.level - x.level);
}

/**
 * Everything between two wrestlers: every relationship they've had, the whole
 * timeline, oldest first, and what's building - { rels, entries, progress }.
 */
export function pairView(st, a, b, derived = relationships(st)) {
  const rels = [...derived.rels.values()].filter(r => (r.a === a && r.b === b) || (r.a === b && r.b === a));
  const entries = derived.entries.filter(e => (e.a === a && e.b === b) || (e.a === b && e.b === a));
  const need = w => (derived.has(w, 'hot-headed', null) ? RULES.streakHotHeaded : derived.has(w, 'patient', null) ? RULES.streakPatient : RULES.streak);
  const loyal = derived.has(a, 'loyal', null) || derived.has(b, 'loyal', null);
  return {
    rels, entries,
    progress: {
      losses: [[a, b], [b, a]].map(([l, w]) => ({ loser: l, winner: w, n: derived.streak.get(`${l}>${w}`) || 0, need: need(l) })),
      together: derived.together.get(pairOf(a, b)) || 0,
      alliesAt: loyal ? RULES.alliesLoyal : RULES.allies,
      friendsAt: RULES.friends,
    },
  };
}

// ---------------------------------------------------------------- in words

const nm = (st, id) => (wrestlerById(st, id) || { name: '(deleted)' }).name;
const at = (st, id) => (eventById(st, id) || { name: 'a show' }).name;

/** What a relationship is, in words: "A holds a grudge against B". */
export function relText(st, r) {
  const [A, B] = [nm(st, r.a), nm(st, r.b)];
  return { grudge: `${A} holds a grudge against ${B}`, rivals: `${A} and ${B} are rivals`, allies: `${A} and ${B} are allies`,
    friends: `${A} and ${B} are friends`, 'former-partners': `${A} and ${B} are former partners` }[r.kind];
}
const endText = (st, r) => {
  const [A, B] = [nm(st, r.a), nm(st, r.b)];
  return { grudge: `${A} lets the grudge against ${B} go`, rivals: `${A} and ${B} are no longer rivals`, allies: `${A} and ${B} are no longer allies`,
    friends: `${A} and ${B} are no longer friends`, 'former-partners': `${A} and ${B} are no longer counted as former partners` }[r.kind];
};
/** The level, in words: "heat 2" - or '' for former partners. */
export const levelText = r => (LEVEL_WORD[r.kind] ? `${LEVEL_WORD[r.kind]} ${r.level}` : '');

/** One timeline entry as { cause, result } sentences. */
export function entryText(st, e) {
  const c = e.cause;
  const A = nm(st, e.a), B = nm(st, e.b);
  let cause;
  switch (c.type) {
    case 'losses': cause = `${nm(st, c.loser)} lost to ${nm(st, c.winner)} for the ${nth(c.n)} time running at ${at(st, c.event)}`; break;
    case 'title': cause = `${nm(st, c.loser)} lost the ${(titleById(st, c.title) || { name: 'title' }).name} to ${nm(st, c.winner)} at ${at(st, c.event)}`; break;
    case 'betrayal': cause = `${nm(st, c.by)} betrayed ${nm(st, c.on)} at ${at(st, c.event)}`; break;
    case 'interference': cause = `${nm(st, c.by)} interfered against ${nm(st, c.on)} at ${at(st, c.event)}`; break;
    case 'attack': cause = `${nm(st, c.by)} attacked ${nm(st, c.on)} at ${at(st, c.event)}`; break;
    case 'helped': cause = `${nm(st, c.by)} interfered to help ${nm(st, c.helped)} at ${at(st, c.event)}`; break;
    case 'partners': cause = `${nm(st, c.x)} and ${nm(st, c.y)} teamed up for the ${nth(c.n)} time at ${at(st, c.event)}`; break;
    case 'left': cause = `${nm(st, c.who)} left ${(teamById(st, c.team) || { name: 'their team' }).name}`; break;
    case 'disbanded': cause = `${(teamById(st, c.team) || { name: 'Their team' }).name} disbanded`; break;
    default: {
      const ed = c.edit;
      cause = e.at ? 'Your change' : 'Your change, counted from the start';
      if (ed.note) cause += ` — ${ed.note}`;
    }
  }
  const word = LEVEL_WORD[e.kind];
  const who = { grudge: `${A}'s grudge against ${B}`, rivals: `${A} and ${B}'s rivalry`, allies: `${A} and ${B}'s alliance`,
    friends: `${A} and ${B}'s friendship`, 'former-partners': `${A} and ${B} as former partners` }[e.kind];
  const result = {
    formed: relText(st, e) + (word && e.level > 1 ? ` (${word} ${e.level})` : ''),
    raised: `${who} grows to ${word} ${e.level}`,
    fuelled: `${who} is already at its hottest`,
    set: `${who} set to ${word} ${e.level}`,
    ended: endText(st, e),
    note: `A note on ${who}`,
    nothing: `${who.charAt(0).toUpperCase()}${who.slice(1)} had already ended — nothing to end`,
  }[e.change];
  return { cause, result };
}

/** Every relationship now, as a comparable snapshot - to say what a change just did. */
export function snapshot(st) {
  const out = new Map();
  relationships(st).rels.forEach(r => { if (r.active) out.set(r.key, r.level); });
  return out;
}
/** What changed between two snapshots, in words, strongest news first. */
export function changesBetween(st, before, after) {
  const out = [];
  const rel = key => {
    const [kind, rest] = key.split(':');
    const [a, b] = kind === 'grudge' ? rest.split('>') : rest.split('+');
    return { kind, a, b };
  };
  after.forEach((level, key) => {
    const r = { ...rel(key), level };
    if (!before.has(key)) out.push(relText(st, r) + (LEVEL_WORD[r.kind] && level > 1 ? ` (${LEVEL_WORD[r.kind]} ${level})` : ''));
    else if (before.get(key) !== level) out.push(`${relText(st, r)} — now ${LEVEL_WORD[r.kind]} ${level}`);
  });
  before.forEach((level, key) => { if (!after.has(key)) out.push(endText(st, rel(key))); });
  return out;
}
