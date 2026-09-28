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
//   Save          the attacker holds a grudge against whoever made the save;
//                 the one saved becomes their ally.
//   Brawl         a grudge each way, and they're rivals.
//   Challenge     a title challenge, or calling someone out - rivals.
//   Walk-out      leaving a team on bad terms - a grudge against the one who
//                 walked, and any friendship or alliance between them ends.
//   Momentum      an unlikely run - nothing between anyone.
//   Confrontation a backstage face-off - they're rivals, or more so.
//   Alliance      joining forces - allies, or stronger ones.
//   Tension       friction between partners - an alliance or friendship
//                 weakens a step.
//   Truce         a rivalry cooling off - each grudge and the rivalry drop a step.
//   Open challenge, turn - nothing between anyone by themselves.
//   Teammates     on a tag team together - allies at strength 3, from the
//                 moment they team up (or reunite).
//   Distrust      between allies, anything that gives a reason not to trust:
//                 tension, a confrontation, a challenge or a grudge forming -
//                 the alliance weakens a step; an attack, an interference
//                 against the other or a brawl - two steps (and a friendship
//                 one). A betrayal or a walk-out ends it. At nothing, it ends
//                 - even if they're still on the team.
//   Partnership   5 matches on the same side - allies (loyal: 3); 12 -
//                 friends (never for the opportunistic, or with a grudge
//                 between them).
//   Split         leaving a team, or it disbanding - former partners, and
//                 the alliance weakens a step.
//
// Tag teams have relationships with each other too - a grudge, a rivalry,
// an alliance - and each extends to every pair of their members, as long as
// both are on their teams: "through their teams". Between two teams:
//   Losses        a team losing 3 times running to the same team, as teams - a
//                 grudge against them.
//   Title defeat  a tag title lost to another team - a grudge, and rivals.
//   Story         an attack, an interference or a betrayal by a member of one
//                 team on a member of another - a grudge; a brawl - grudges
//                 and rivals; a confrontation or challenge - rivals; a save or
//                 an interference helping a member of another team, or an
//                 alliance across teams - allies; a truce - cools them. An
//                 alliance between the teams loses trust the same way as one
//                 between two wrestlers (a betrayal or walk-out ends it).
//   Members       an alliance between teams doesn't reach two members with a
//                 grudge between them.
//   The owner     can start, set or end any of it, like any relationship.
// Heat and strength run 1-3. Traits count as they were at the time; the
// app never changes a trait.
import { compareStamps, eventById, teamById, titleById, wrestlerById } from './model.js';

// a team relationship's key: "team:grudge:t1>t2" (one-way), "team:rivals:t1+t2"
export const teamRelKey = (kind, a, b) => `team:${kind === 'grudge' ? `${kind}:${a}>${b}` : `${kind}:${a < b ? `${a}+${b}` : `${b}+${a}`}`}`;

export const RULES = { streak: 3, streakHotHeaded: 2, streakPatient: 4, allies: 5, alliesLoyal: 3, friends: 12, teammates: 3, teamStreak: 3 };
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
 *            set | cooled | ended | note | nothing (an end with nothing to end)
 */
export function relationships(st) {
  const rels = new Map();
  const entries = [];
  const dismissed = new Map(st.relEdits.filter(e => e.action === 'dismiss').map(e => [e.key, e]));
  const streak = new Map();                   // `${loser}>${winner}` -> losses in a row
  const tstreak = new Map();                  // the same, for teams as teams
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
  // between two tag teams: the same shape, kept apart
  const teams = new Map();
  const teamEntries = [];
  const tget = (kind, a, b) => {
    const key = teamRelKey(kind, a, b);
    if (!teams.has(key)) {
      const [x, y] = kind === 'grudge' ? [a, b] : [a, b].sort();
      teams.set(key, { key, kind, a: x, b: y, active: false, level: 0, since: null, entries: [], team: true });
    }
    return teams.get(key);
  };
  // what an operation would do to a relationship, without doing it
  const outcome = (r, op, amount) => {
    if (op === 'end') return r.active ? { active: false, level: 0, change: 'ended' } : null;
    if (op === 'form') return r.active ? null : { active: true, level: Math.max(1, amount), change: 'formed' };
    if (op === 'set') return { active: true, level: amount, change: r.active ? 'set' : 'formed' };
    if (op === 'atleast') return !r.active ? { active: true, level: amount, change: 'formed' } : r.level < amount ? { active: true, level: amount, change: 'raised' } : null;
    if (op === 'lower') {
      if (!r.active) return null;
      return r.level - amount > 0 ? { active: true, level: r.level - amount, change: 'cooled' } : { active: false, level: 0, change: 'ended' };
    }
    if (!r.active) return { active: true, level: Math.min(3, amount), change: 'formed' };           // raise
    return r.level < 3 ? { active: true, level: Math.min(3, r.level + amount), change: 'raised' } : { active: true, level: 3, change: 'fuelled' };
  };
  const record = (r, next, at, extra) => {
    const e = { rel: r.key, kind: r.kind, a: r.a, b: r.b, at, change: next.change, level: next.level, ...extra };
    r.entries.push(e);
    (r.team ? teamEntries : entries).push(e);
    if (r.team) e.team = true;
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
  const tauto = (kind, a, b, op, amount, cause) => {
    const r = tget(kind, a, b);
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
  // a reason not to trust an ally: the alliance weakens (by two, a friendship too)
  const distrust = (x, y, n, cause) => {
    auto('allies', x, y, 'lower', n, cause);
    if (n >= 2) auto('friends', x, y, 'lower', 1, cause);
  };
  // the tag teams someone was on, together, at a moment
  const activeAt = (t, at) => { let on = false; t.log.forEach(l => { if (!at || compareStamps(st, l.at, at) <= 0) on = l.type !== 'disbanded'; }); return on; };
  const teamsAt = (x, at) => st.teams.filter(t => activeAt(t, at) && st.memberships.some(ms => ms.team === t.id && ms.wrestler === x
    && compareStamps(st, ms.start, at) <= 0 && (!ms.end || compareStamps(st, ms.end, at) > 0)));
  // every pair of teams an incident sets against each other - never a team and itself, or two sharing the pair
  const teamPairs = (xs, ys, at) => {
    const out = new Map();
    xs.forEach(x => ys.forEach(y => teamsAt(x, at).forEach(A => teamsAt(y, at).forEach(B => {
      if (A.id === B.id || A.members.includes(y) || B.members.includes(x)) return;
      out.set(`${A.id}>${B.id}`, [A.id, B.id]);
    }))));
    return [...out.values()];
  };

  // ---- everything that can change a relationship, in calendar order
  const items = [];
  st.relEdits.filter(e => e.action !== 'dismiss').forEach(e => items.push({ at: e.at, order: 0, type: 'edit', e }));
  st.events.forEach(ev => {
    ev.matches.forEach((m, i) => { if (m.status === 'played') items.push({ at: ev.at, order: i + 1, type: 'match', ev, m }); });
    // what happened before the show comes before its matches; everything else after
    ev.incidents.forEach((inc, j) => items.push({ at: ev.at, order: inc.phase === 'pre' ? 0.5 + j / 1000 : 1000 + j, type: 'incident', ev, inc }));
  });
  st.memberships.forEach(ms => { if (ms.end) items.push({ at: ms.end, order: 0, type: 'left', ms }); });
  st.memberships.forEach(ms => items.push({ at: ms.start, order: -1, type: 'joined', ms }));
  st.teams.forEach(t => t.log.forEach(l => {
    if (l.type === 'disbanded') items.push({ at: l.at, order: 0, type: 'disbanded', t, l });
    if (l.type === 'reunited') items.push({ at: l.at, order: -1, type: 'reunited', t, l });
  }));
  items.sort((x, y) => (!x.at && !y.at ? 0 : !x.at ? -1 : !y.at ? 1 : compareStamps(st, x.at, y.at) || x.order - y.order));
  const reignOf = new Map(st.reigns.filter(r => r.matchId).map(r => [r.matchId, r]));

  for (const it of items) {
    if (it.type === 'edit') {
      const e = it.e;
      const r = e.teams ? tget(e.kind, e.a, e.b) : get(e.kind, e.a, e.b);
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
              const cause = { ...base, key: `loss:${m.id}:${l}>${w}`, type: 'losses', loser: l, winner: w, n };
              auto('grudge', l, w, 'raise', 1, cause);
              distrust(l, w, 1, cause);
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
              distrust(l, w, 1, cause);
            }));
          });
          // a tag title lost from one team to another
          const wt = m.sides[m.winner].team || (reign.holder.type === 'team' ? reign.holder.id : null);
          if (prev.holder.type === 'team' && wt && wt !== prev.holder.id) {
            const cause = { ...base, key: `teamtitle:${reign.id}`, type: 'team-title', loser: prev.holder.id, winner: wt, title: reign.titleId };
            tauto('grudge', prev.holder.id, wt, 'raise', 1, cause);
            tauto('rivals', prev.holder.id, wt, 'raise', 1, cause);
          }
        }
        // teams, as teams: a losing run against the same team
        const WT = m.sides[m.winner].team;
        if (WT) {
          m.sides.forEach((sd, i) => {
            if (i === m.winner || !sd.team || sd.team === WT) return;
            tstreak.set(`${WT}>${sd.team}`, 0);
            const n = (tstreak.get(`${sd.team}>${WT}`) || 0) + 1;
            if (n >= RULES.teamStreak) {
              tauto('grudge', sd.team, WT, 'raise', 1, { ...base, key: `teamloss:${m.id}:${sd.team}>${WT}`, type: 'team-losses', loser: sd.team, winner: WT, n });
              tstreak.set(`${sd.team}>${WT}`, 0);
            } else tstreak.set(`${sd.team}>${WT}`, n);
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
      const base = { at: ev.at, event: ev.id, match: inc.match, incident: inc.id, kind: inc.kind, title: inc.title, team: inc.team };
      inc.by.forEach(x => inc.on.forEach(y => {
        const cause = { ...base, key: `inc:${inc.id}:${y}>${x}`, type: inc.kind, by: x, on: y };
        switch (inc.kind) {
          case 'betrayal':
            auto('grudge', y, x, 'raise', has(y, 'loyal', ev.at) ? 3 : 2, cause);
            auto('friends', x, y, 'end', 0, cause);
            auto('allies', x, y, 'end', 0, cause);
            break;
          case 'attack': auto('grudge', y, x, 'raise', has(y, 'hot-headed', ev.at) ? 2 : 1, cause); distrust(x, y, 2, cause); break;
          case 'brawl':
            auto('grudge', y, x, 'raise', 1, cause);
            auto('grudge', x, y, 'raise', 1, cause);
            auto('rivals', x, y, 'raise', 1, cause);
            distrust(x, y, 2, cause);
            break;
          case 'challenge': case 'demand': case 'confrontation': auto('rivals', x, y, 'raise', 1, cause); distrust(x, y, 1, cause); break;
          case 'alliance': auto('allies', x, y, 'raise', 1, cause); break;
          case 'tension':
            auto('allies', x, y, 'lower', 1, cause);
            auto('friends', x, y, 'lower', 1, cause);
            break;
          case 'truce':
            auto('grudge', y, x, 'lower', 1, cause);
            auto('grudge', x, y, 'lower', 1, cause);
            auto('rivals', x, y, 'lower', 1, cause);
            break;
          case 'breakup':
            auto('grudge', y, x, 'raise', 1, cause);
            auto('friends', x, y, 'end', 0, cause);
            auto('allies', x, y, 'end', 0, cause);
            break;
          default:                                                          // an interference, a save
            auto('grudge', y, x, 'raise', 1, cause);
            distrust(x, y, inc.kind === 'interference' ? 2 : 1, cause);
        }
      }));
      // between tag teams: what one team's member did to another's
      const tcause = (A, B, extra = '') => ({ ...base, key: `tinc:${inc.id}:${A}>${B}${extra}`, type: inc.kind, by: inc.by[0], on: inc.on[0], byTeam: A, onTeam: B });
      teamPairs(inc.by, inc.on, ev.at).forEach(([A, B]) => {
        const c = tcause(A, B);
        switch (inc.kind) {
          case 'attack': case 'interference': tauto('grudge', B, A, 'raise', 1, c); tauto('allies', A, B, 'lower', 2, c); break;
          case 'betrayal': case 'breakup': tauto('grudge', B, A, 'raise', 1, c); tauto('allies', A, B, 'end', 0, c); break;
          case 'save': tauto('grudge', B, A, 'raise', 1, c); tauto('allies', A, B, 'lower', 1, c); break;   // the attacker's team, against the saver's
          case 'brawl':
            tauto('grudge', B, A, 'raise', 1, c); tauto('grudge', A, B, 'raise', 1, c); tauto('rivals', A, B, 'raise', 1, c);
            tauto('allies', A, B, 'lower', 2, c);
            break;
          case 'confrontation': case 'challenge': case 'demand': tauto('rivals', A, B, 'raise', 1, c); tauto('allies', A, B, 'lower', 1, c); break;
          case 'alliance': tauto('allies', A, B, 'raise', 1, c); break;
          case 'truce': tauto('grudge', A, B, 'lower', 1, c); tauto('grudge', B, A, 'lower', 1, c); tauto('rivals', A, B, 'lower', 1, c); break;
          default:
        }
      });
      if (inc.kind === 'interference' || inc.kind === 'save') {
        teamPairs(inc.by, inc.helped, ev.at).forEach(([A, B]) => tauto('allies', A, B, 'raise', 1, { ...tcause(A, B, ':helped'), type: inc.kind === 'save' ? 'saved' : 'helped', helped: inc.helped[0] }));
      }
      if (inc.kind === 'interference' || inc.kind === 'save') {
        inc.by.forEach(x => inc.helped.forEach(h => auto('allies', x, h, 'raise', 1,
          { ...base, key: `inc:${inc.id}:${x}>${h}:helped`, type: inc.kind === 'save' ? 'saved' : 'helped', by: x, helped: h })));
      }
      continue;
    }
    if (it.type === 'joined') {
      // teammates: allies at full strength from the moment they're on a team together
      const { ms } = it;
      const t = st.teams.find(x => x.id === ms.team);
      if (!t || !activeAt(t, ms.start)) continue;
      // each pair once: when the later of the two joined (founders: one of them)
      const before = o => { const c = compareStamps(st, o.start, ms.start); return c < 0 || (c === 0 && o.id < ms.id); };
      st.memberships.filter(o => o.team === ms.team && o.wrestler !== ms.wrestler && before(o)
        && (!o.end || compareStamps(st, ms.start, o.end) < 0)).forEach(o => auto('allies', ms.wrestler, o.wrestler, 'atleast', RULES.teammates,
        { at: ms.start, key: `teamed:${ms.id}:${pairOf(ms.wrestler, o.wrestler)}`, type: 'teamed', x: ms.wrestler, y: o.wrestler, team: ms.team,
          joined: compareStamps(st, o.start, ms.start) < 0 }));
      continue;
    }
    if (it.type === 'reunited') {
      const { t, l } = it;
      const on = st.memberships.filter(o => o.team === t.id && compareStamps(st, o.start, l.at) <= 0 && (!o.end || compareStamps(st, o.end, l.at) > 0))
        .map(o => o.wrestler);
      for (let i = 0; i < on.length; i++) {
        for (let j = i + 1; j < on.length; j++) {
          auto('allies', on[i], on[j], 'atleast', RULES.teammates, { at: l.at, key: `reunited:${t.id}:${l.at.seq}:${pairOf(on[i], on[j])}`, type: 'reunited', team: t.id });
        }
      }
      continue;
    }
    if (it.type === 'left') {
      const { ms } = it;
      st.memberships.filter(o => o.team === ms.team && o.wrestler !== ms.wrestler && compareStamps(st, o.start, ms.end) < 0
        && (!o.end || compareStamps(st, ms.start, o.end) < 0)).forEach(o => {
        const cause = { at: ms.end, key: `left:${ms.id}:${pairOf(ms.wrestler, o.wrestler)}`, type: 'left', who: ms.wrestler, team: ms.team };
        auto('former-partners', ms.wrestler, o.wrestler, 'form', 1, cause);
        auto('allies', ms.wrestler, o.wrestler, 'lower', 1, cause);
      });
      continue;
    }
    if (it.type === 'disbanded') {
      const { t, l } = it;
      const on = st.memberships.filter(o => o.team === t.id && compareStamps(st, o.start, l.at) <= 0 && (!o.end || compareStamps(st, o.end, l.at) > 0))
        .map(o => o.wrestler);
      for (let i = 0; i < on.length; i++) {
        for (let j = i + 1; j < on.length; j++) {
          const cause = { at: l.at, key: `disband:${t.id}:${l.at.seq}:${pairOf(on[i], on[j])}`, type: 'disbanded', team: t.id };
          auto('former-partners', on[i], on[j], 'form', 1, cause);
          auto('allies', on[i], on[j], 'lower', 1, cause);
        }
      }
    }
  }
  // a relationship between two teams extends to every pair of their members, while both are on them:
  // the pair's relationship is at least as strong, and says it's through their teams
  teams.forEach(tr => {
    if (!tr.active) return;
    const A = teamById(st, tr.a), B = teamById(st, tr.b);
    if (!A || !B || !A.active || !B.active) return;
    A.members.forEach(x => B.members.forEach(y => {
      if (x === y || A.members.includes(y) || B.members.includes(x)) return;
      // no alliance through their teams for two with a grudge between them
      if (tr.kind === 'allies' && (get('grudge', x, y).active || get('grudge', y, x).active)) return;
      const r = get(tr.kind, x, y);
      if (r.active && r.level >= tr.level) return;
      if (r.own === undefined) r.own = r.active ? r.level : 0;
      if (!r.active) r.since = tr.since;
      r.active = true;
      r.level = tr.level;
      r.via = { key: tr.key, a: A.id, b: B.id, level: tr.level };
    }));
  });
  return { rels, entries, streak, together, has, teams, teamEntries };
}

/** A tag team's relationships with other teams now, strongest first. */
export function teamRelationsOf(st, teamId, derived = relationships(st)) {
  const order = { grudge: 0, rivals: 1, allies: 2 };
  return [...derived.teams.values()].filter(r => r.active && (r.a === teamId || r.b === teamId))
    .sort((x, y) => order[x.kind] - order[y.kind] || y.level - x.level);
}
/** Where a wrestler's relationship comes from when it's through their teams: "through KO & Sami and Judgment Day" - or ''. */
export function viaText(st, r) {
  if (!r.via) return '';
  const tn = id => (teamById(st, id) || { name: 'their team' }).name;
  return `through ${tn(r.via.a)} and ${tn(r.via.b)}`;
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
  // and the timeline of any team relationship theirs comes through
  const via = new Set(rels.filter(r => r.active && r.via).map(r => r.via.key));
  const entries = [...derived.entries.filter(e => (e.a === a && e.b === b) || (e.a === b && e.b === a)),
    ...derived.teamEntries.filter(e => via.has(e.rel))]
    .sort((x, y) => (!x.at && !y.at ? 0 : !x.at ? -1 : !y.at ? 1 : compareStamps(st, x.at, y.at)));
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

const tn = (st, id) => (teamById(st, id) || { name: '(deleted team)' }).name;
/** What a relationship between two teams is, in words: "KO & Sami hold a grudge against Judgment Day". */
export function teamRelText(st, r) {
  const [A, B] = [tn(st, r.a), tn(st, r.b)];
  return { grudge: `${A} hold a grudge against ${B}`, rivals: `${A} and ${B} are rivals`, allies: `${A} and ${B} are allies` }[r.kind];
}
const teamEndText = (st, r) => {
  const [A, B] = [tn(st, r.a), tn(st, r.b)];
  return { grudge: `${A} let the grudge against ${B} go`, rivals: `${A} and ${B} are no longer rivals`, allies: `${A} and ${B} are no longer allies` }[r.kind];
};

/** What a relationship is, in words: "A holds a grudge against B". */
export function relText(st, r) {
  if (r.team) return teamRelText(st, r);
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
  if (e.team) return teamEntryText(st, e);
  const c = e.cause;
  const A = nm(st, e.a), B = nm(st, e.b);
  let cause;
  switch (c.type) {
    case 'teamed': {
      const t = teamById(st, c.team) || { name: 'a team' };
      const first = w => st.memberships.findIndex(m => m.team === c.team && m.wrestler === w);   // founders in line-up order
      const [p, q] = !c.joined && first(c.y) < first(c.x) ? [c.y, c.x] : [c.x, c.y];
      cause = c.joined ? `${nm(st, c.x)} joined ${t.name}, alongside ${nm(st, c.y)}` : `${nm(st, p)} and ${nm(st, q)} teamed up as ${t.name}`;
      break;
    }
    case 'reunited': cause = `${(teamById(st, c.team) || { name: 'Their team' }).name} reunited`; break;
    case 'losses': cause = `${nm(st, c.loser)} lost to ${nm(st, c.winner)} for the ${nth(c.n)} time running at ${at(st, c.event)}`; break;
    case 'title': cause = `${nm(st, c.loser)} lost the ${(titleById(st, c.title) || { name: 'title' }).name} to ${nm(st, c.winner)} at ${at(st, c.event)}`; break;
    case 'betrayal': cause = `${nm(st, c.by)} betrayed ${nm(st, c.on)} at ${at(st, c.event)}`; break;
    case 'interference': cause = `${nm(st, c.by)} interfered against ${nm(st, c.on)} at ${at(st, c.event)}`; break;
    case 'attack': cause = `${nm(st, c.by)} attacked ${nm(st, c.on)} at ${at(st, c.event)}`; break;
    case 'helped': cause = `${nm(st, c.by)} interfered to help ${nm(st, c.helped)} at ${at(st, c.event)}`; break;
    case 'save': cause = `${nm(st, c.by)} made the save against ${nm(st, c.on)} at ${at(st, c.event)}`; break;
    case 'saved': cause = `${nm(st, c.by)} made the save for ${nm(st, c.helped)} at ${at(st, c.event)}`; break;
    case 'brawl': cause = `${nm(st, c.by)} and ${nm(st, c.on)} brawled at ${at(st, c.event)}`; break;
    case 'challenge': cause = `${nm(st, c.by)} challenged ${nm(st, c.on)} for the ${(titleById(st, c.title) || { name: 'title' }).name} at ${at(st, c.event)}`; break;
    case 'demand': cause = `${nm(st, c.by)} called out ${nm(st, c.on)}${c.title ? ` over the ${(titleById(st, c.title) || { name: 'title' }).name}` : ''} at ${at(st, c.event)}`; break;
    case 'breakup': cause = `${nm(st, c.by)} walked out on ${nm(st, c.on)}${c.team ? ` and ${(teamById(st, c.team) || { name: 'their team' }).name}` : ''} at ${at(st, c.event)}`; break;
    case 'confrontation': cause = `${nm(st, c.by)} confronted ${nm(st, c.on)} at ${at(st, c.event)}`; break;
    case 'alliance': cause = `${nm(st, c.by)} and ${nm(st, c.on)} joined forces at ${at(st, c.event)}`; break;
    case 'tension': cause = `${nm(st, c.by)} and ${nm(st, c.on)} clashed${c.team ? ` — trouble in ${(teamById(st, c.team) || { name: 'their team' }).name}` : ''} at ${at(st, c.event)}`; break;
    case 'truce': cause = `${nm(st, c.by)} and ${nm(st, c.on)} called a truce at ${at(st, c.event)}`; break;
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
    cooled: `${who} cools to ${word} ${e.level}`,
    nothing: `${who.charAt(0).toUpperCase()}${who.slice(1)} had already ended — nothing to end`,
  }[e.change];
  return { cause, result };
}

/** One team timeline entry as { cause, result } sentences. */
export function teamEntryText(st, e) {
  const c = e.cause;
  const who = (w, t) => `${nm(st, w)}${t ? ` (${tn(st, t)})` : ''}`;
  let cause;
  switch (c.type) {
    case 'team-losses': cause = `${tn(st, c.loser)} lost to ${tn(st, c.winner)} for the ${nth(c.n)} time running at ${at(st, c.event)}`; break;
    case 'team-title': cause = `${tn(st, c.loser)} lost the ${(titleById(st, c.title) || { name: 'title' }).name} to ${tn(st, c.winner)} at ${at(st, c.event)}`; break;
    case 'attack': cause = `${who(c.by, c.byTeam)} attacked ${who(c.on, c.onTeam)} at ${at(st, c.event)}`; break;
    case 'interference': cause = `${who(c.by, c.byTeam)} interfered against ${who(c.on, c.onTeam)} at ${at(st, c.event)}`; break;
    case 'betrayal': cause = `${who(c.by, c.byTeam)} betrayed ${who(c.on, c.onTeam)} at ${at(st, c.event)}`; break;
    case 'breakup': cause = `${who(c.by, c.byTeam)} walked out on ${who(c.on, c.onTeam)} at ${at(st, c.event)}`; break;
    case 'save': cause = `${who(c.by, c.byTeam)} made the save against ${who(c.on, c.onTeam)} at ${at(st, c.event)}`; break;
    case 'saved': cause = `${who(c.by, c.byTeam)} made the save for ${who(c.helped, c.onTeam)} at ${at(st, c.event)}`; break;
    case 'helped': cause = `${who(c.by, c.byTeam)} interfered to help ${who(c.helped, c.onTeam)} at ${at(st, c.event)}`; break;
    case 'brawl': cause = `${who(c.by, c.byTeam)} and ${who(c.on, c.onTeam)} brawled at ${at(st, c.event)}`; break;
    case 'confrontation': cause = `${who(c.by, c.byTeam)} confronted ${who(c.on, c.onTeam)} at ${at(st, c.event)}`; break;
    case 'challenge': case 'demand': cause = `${who(c.by, c.byTeam)} called out ${who(c.on, c.onTeam)} at ${at(st, c.event)}`; break;
    case 'alliance': cause = `${who(c.by, c.byTeam)} and ${who(c.on, c.onTeam)} joined forces at ${at(st, c.event)}`; break;
    case 'truce': cause = `${who(c.by, c.byTeam)} and ${who(c.on, c.onTeam)} called a truce at ${at(st, c.event)}`; break;
    default: {
      const ed = c.edit;
      cause = e.at ? 'Your change' : 'Your change, counted from the start';
      if (ed && ed.note) cause += ` — ${ed.note}`;
    }
  }
  const word = LEVEL_WORD[e.kind];
  const [A, B] = [tn(st, e.a), tn(st, e.b)];
  const what = { grudge: `${A}'s grudge against ${B}`, rivals: `${A} and ${B}'s rivalry`, allies: `${A} and ${B}'s alliance` }[e.kind];
  const result = {
    formed: teamRelText(st, e) + (e.level > 1 ? ` (${word} ${e.level})` : ''),
    raised: `${what} grows to ${word} ${e.level}`,
    fuelled: `${what} is already at its hottest`,
    set: `${what} set to ${word} ${e.level}`,
    ended: teamEndText(st, e),
    note: `A note on ${what}`,
    cooled: `${what} cools to ${word} ${e.level}`,
    nothing: `${what.charAt(0).toUpperCase()}${what.slice(1)} had already ended — nothing to end`,
  }[e.change];
  return { cause, result };
}

/** Every relationship now, as a comparable snapshot - to say what a change just did. */
export function snapshot(st) {
  const out = new Map();
  const d = relationships(st);
  // a wrestler's own relationships (what comes through their teams is news about the teams), and the teams'
  d.rels.forEach(r => { const own = r.via ? r.own : r.level; if (r.active && own) out.set(r.key, own); });
  d.teams.forEach(r => { if (r.active) out.set(r.key, r.level); });
  return out;
}
/** What changed between two snapshots, in words, strongest news first. */
export function changesBetween(st, before, after) {
  const out = [];
  const rel = key => {
    const team = key.startsWith('team:');
    const [kind, rest] = (team ? key.slice(5) : key).split(':');
    const [a, b] = kind === 'grudge' ? rest.split('>') : rest.split('+');
    return { kind, a, b, team };
  };
  after.forEach((level, key) => {
    const r = { ...rel(key), level };
    if (!before.has(key)) out.push(relText(st, r) + (LEVEL_WORD[r.kind] && level > 1 ? ` (${LEVEL_WORD[r.kind]} ${level})` : ''));
    else if (before.get(key) !== level) out.push(`${relText(st, r)} — now ${LEVEL_WORD[r.kind]} ${level}`);
  });
  before.forEach((level, key) => { if (!after.has(key)) { const r = rel(key); out.push(r.team ? teamEndText(st, r) : endText(st, r)); } });
  return out;
}
