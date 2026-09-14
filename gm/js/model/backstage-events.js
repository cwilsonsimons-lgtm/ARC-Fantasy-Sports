// What the building throws at you, and who it happens to.
//
// Each kind knows how to find its own people and its own room. They are
// gathered, weighted and one is drawn — so a quiet locker room genuinely is
// quiet, and a room full of grudges produces the trouble it has earned rather
// than a uniform trickle of random events.
//
// Nothing here decides what the GM does about any of it. That is the point of
// the separation: an incident is a situation, and it happens whether or not
// anybody with authority is standing in the room.
import { byId } from './wrestlers.js';
import { trait, lean } from './traits.js';
import { relationship } from './relationships.js';
import { roomOf, troubleFactor, authorityValue } from './backstage.js';
import { currentItem, upcomingItems } from './broadcast.js';
import { gmStandingValue } from './memory.js';
import { nextId } from '../ids.js';
import { incidentKind } from '../data/backstage.js';

// How much trouble a minute of backstage time is worth, before the state of the
// room is read. Everything else scales off this.
export const PER_MINUTE = 0.022;

function fit(state) {
  return state.wrestlers.filter(w => roomOf(state, w.id));
}

function grudgesToward(wrestler, targetId) {
  return (wrestler.grudges || []).filter(g => g.targetId === targetId).length;
}

function managementGrudges(wrestler) {
  return (wrestler.grudges || []).filter(g => g.targetId === null).length;
}

function unhappiness(wrestler) {
  return Math.max(0, (55 - wrestler.morale) / 55); // 0 at content, 1 at furious
}

// ---------------------------------------------------------------- the kinds

// Two people who cannot stand each other, standing in the same room.
function pairsInARoom(state) {
  const people = fit(state);
  const pairs = [];
  for (let i = 0; i < people.length; i += 1) {
    for (let j = i + 1; j < people.length; j += 1) {
      const a = people[i];
      const b = people[j];
      if (roomOf(state, a.id) !== roomOf(state, b.id)) continue;
      const rel = relationship(a, b.id);
      const heat = rel.matches
        + (rel.tie === 'bad-blood' ? 5 : 0)
        + grudgesToward(a, b.id) * 4
        + grudgesToward(b, a.id) * 4;
      if (heat >= 4) pairs.push({ a, b, heat, room: roomOf(state, a.id) });
    }
  }
  return pairs.sort((x, y) => y.heat - x.heat);
}

function findArgument(state, roll) {
  const pairs = pairsInARoom(state);
  if (!pairs.length) return null;
  const chosen = pairs[Math.floor(roll() * Math.min(pairs.length, 5))] || pairs[0];
  return {
    kind: 'argument',
    aggressorId: chosen.a.id, victimId: chosen.b.id, locationId: chosen.room,
  };
}

// The same situation, with somebody in it who does not stop at shouting.
function findBrawl(state, roll) {
  const pairs = pairsInARoom(state).filter(({ a, b }) =>
    trait(a, 'aggression') > 58 || trait(b, 'aggression') > 58);
  if (!pairs.length) return null;
  const chosen = pairs[Math.floor(roll() * Math.min(pairs.length, 3))] || pairs[0];
  const first = trait(chosen.a, 'aggression') >= trait(chosen.b, 'aggression') ? chosen.a : chosen.b;
  const other = first === chosen.a ? chosen.b : chosen.a;
  return {
    kind: 'brawl',
    aggressorId: first.id, victimId: other.id, locationId: chosen.room,
  };
}

// Somebody who has been carrying a grudge goes and finds the person it is
// about. Unlike a brawl this does not need them to already be in a room
// together — it needs one of them to have decided to go looking.
function findAmbush(state, roll) {
  const candidates = [];
  for (const wrestler of fit(state)) {
    const nerve = lean(wrestler, 'aggression') + lean(wrestler, 'vindictiveness') - lean(wrestler, 'patience');
    if (nerve < 0.2) continue;
    for (const grudge of wrestler.grudges || []) {
      if (!grudge.targetId) continue;
      const target = byId(state.wrestlers, grudge.targetId);
      if (!target || !roomOf(state, target.id)) continue;
      candidates.push({ wrestler, target, nerve });
    }
  }
  if (!candidates.length) return null;
  const chosen = candidates[Math.floor(roll() * candidates.length)];
  return {
    kind: 'ambush',
    aggressorId: chosen.wrestler.id,
    victimId: chosen.target.id,
    // Where the victim is. They went to them.
    locationId: roomOf(state, chosen.target.id),
  };
}

// What somebody is asking for, read off why they are unhappy.
function demandFor(state, wrestler, roll) {
  const onCard = state.show.items.some(item => item.participants.includes(wrestler.id));
  if (!onCard) return 'airtime';
  if (trait(wrestler, 'ambition') > 68 && roll() < 0.5) return 'title';
  if (trait(wrestler, 'ego') > 68) return 'spot';
  if (gmStandingValue(wrestler, state.week) < -14 && roll() < 0.4) return 'apology';
  if (wrestler.morale < 18 && lean(wrestler, 'loyalty') < -0.2 && roll() < 0.3) return 'out';
  return roll() < 0.5 ? 'match' : 'spot';
}

// Comes to the office, because they are still being polite about it.
function findComplaint(state, roll) {
  const candidates = fit(state).filter(w =>
    unhappiness(w) > 0.2 && trait(w, 'ambition') > 45);
  if (!candidates.length) return null;
  const chosen = candidates[Math.floor(roll() * candidates.length)];
  return {
    kind: 'complaint',
    aggressorId: chosen.id, victimId: 'gm', locationId: 'office',
    demand: demandFor(state, chosen, roll),
  };
}

// Past asking. Finds you wherever you are, which is what makes the room you are
// standing in part of the problem.
function findStormIn(state, roll) {
  const candidates = fit(state).filter(w =>
    unhappiness(w) > 0.45
    && (trait(w, 'patience') < 45 || managementGrudges(w) > 0));
  if (!candidates.length) return null;
  const chosen = candidates[Math.floor(roll() * candidates.length)];
  return {
    kind: 'storm-in',
    aggressorId: chosen.id, victimId: 'gm', locationId: state.location,
    demand: demandFor(state, chosen, roll),
  };
}

// Not a demand. A statement, made where people can hear it.
function findConfrontation(state, roll) {
  const candidates = fit(state).filter(w =>
    managementGrudges(w) > 0 && gmStandingValue(w, state.week) < -10);
  if (!candidates.length) return null;
  const chosen = candidates[Math.floor(roll() * candidates.length)];
  return {
    kind: 'confrontation',
    aggressorId: chosen.id, victimId: 'gm', locationId: state.location,
  };
}

// Booked in the next one, standing at the curtain, not moving.
function findRefusal(state, roll) {
  const next = upcomingItems(state.show, state.broadcast)[0]
    || currentItem(state.show, state.broadcast);
  if (!next) return null;

  const candidates = next.participants
    .map(id => byId(state.wrestlers, id))
    .filter(w => w && roomOf(state, w.id) && unhappiness(w) > 0.4 && trait(w, 'professionalism') < 58);
  if (!candidates.length) return null;

  const chosen = candidates[Math.floor(roll() * candidates.length)];
  return {
    kind: 'refusal',
    aggressorId: chosen.id, victimId: 'gm', locationId: 'gorilla',
    itemId: next.id,
    demand: demandFor(state, chosen, roll),
  };
}

// Bag packed. The furthest room from you, and the only incident that removes
// somebody from the promotion if you do not get there.
function findWalkout(state, roll) {
  const candidates = fit(state).filter(w =>
    unhappiness(w) > 0.62 && lean(w, 'loyalty') < 0.1 && managementGrudges(w) > 0);
  if (!candidates.length) return null;
  const chosen = candidates[Math.floor(roll() * candidates.length)];
  return {
    kind: 'walkout',
    aggressorId: chosen.id, victimId: 'gm', locationId: 'parking',
    demand: 'apology',
  };
}

// A named tie under strain. The two of them are not equally happy, and one of
// them has started saying so.
function findTieDispute(state, roll, tie, kind) {
  const pairs = [];
  for (const wrestler of fit(state)) {
    for (const [otherId, rel] of Object.entries(wrestler.relationships || {})) {
      if (rel.tie !== tie) continue;
      const other = byId(state.wrestlers, otherId);
      if (!other || !roomOf(state, other.id)) continue;
      const strain = Math.abs(wrestler.morale - other.morale) / 12
        + unhappiness(wrestler) * 2
        + lean(wrestler, 'jealousy');
      if (strain >= 1.4) pairs.push({ wrestler, other, strain });
    }
  }
  if (!pairs.length) return null;
  pairs.sort((a, b) => b.strain - a.strain);
  const chosen = pairs[Math.floor(roll() * Math.min(pairs.length, 3))] || pairs[0];
  return {
    kind,
    aggressorId: chosen.wrestler.id,
    victimId: chosen.other.id,
    locationId: roomOf(state, chosen.wrestler.id),
  };
}

// ---------------------------------------------------------------- the draw

// Each kind, how likely it is tonight, and how to find it. Weights are shaped by
// the state of the room rather than fixed: nobody storms in when everybody is
// content, and nothing walks out of a promotion with no standing grievances.
function slate(state) {
  const trouble = troubleFactor(state);
  const room = state.wrestlers.filter(w => roomOf(state, w.id));
  const unhappy = room.filter(w => unhappiness(w) > 0.35).length;
  const furious = room.filter(w => unhappiness(w) > 0.6).length;
  const heldGrudges = room.reduce((n, w) => n + managementGrudges(w), 0);
  const lowAuthority = Math.max(0, (50 - authorityValue(state)) / 50);

  return [
    { find: findArgument, weight: 3.4 },
    { find: findBrawl, weight: 1.5 },
    { find: findAmbush, weight: 1.2 },
    { find: findComplaint, weight: 1.0 + unhappy * 0.5 },
    { find: findStormIn, weight: (0.3 + furious * 0.6) * (1 + lowAuthority) },
    { find: findConfrontation, weight: 0.25 + heldGrudges * 0.45 },
    { find: findRefusal, weight: (0.2 + furious * 0.4) * (1 + lowAuthority * 1.5) },
    { find: findWalkout, weight: (0.05 + furious * 0.22) * (1 + lowAuthority * 2) },
    { find: (s, r) => findTieDispute(s, r, 'tag-team', 'tag-dispute'), weight: 0.9 },
    { find: (s, r) => findTieDispute(s, r, 'faction', 'faction-dispute'), weight: 0.8 },
  ].map(entry => ({ ...entry, weight: entry.weight * trouble }));
}

// `pressure` scales the whole thing: 1 for the gap between segments, or a share
// of it for the minutes an action took.
// How many things this stretch of the night has in it. Read off the length of
// the gap and the state of the room — and deliberately *not* off what the GM
// chose to do with the time, because a building that only misbehaves while you
// are walking around would make standing still the winning move, which is the
// opposite of the point.
export function troubleIn(state, minutes, roll) {
  if (minutes <= 0) return [];
  const rate = minutes * PER_MINUTE * troubleFactor(state);
  let count = Math.floor(rate);
  if (roll() < rate - count) count += 1;

  const marks = [];
  for (let i = 0; i < count; i += 1) marks.push(Math.floor(roll() * minutes));
  return marks.sort((a, b) => a - b);
}

// Something is happening. Work out what, and to whom.
//
// A kind with nobody to pick simply does not happen, and the next one is tried
// instead — which is what makes a settled roster quiet without a separate rule
// saying so.
export function drawIncident(state, roll) {
  const entries = slate(state).filter(e => e.weight > 0);
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  if (!total) return null;

  let pick = roll() * total;
  const ordered = [...entries];
  let drawn = ordered[ordered.length - 1];
  for (const entry of ordered) {
    pick -= entry.weight;
    if (pick <= 0) { drawn = entry; break; }
  }

  const first = drawn.find(state, roll);
  if (first) return decorate(state, first);

  for (const entry of ordered) {
    if (entry === drawn) continue;
    const found = entry.find(state, roll);
    if (found) return decorate(state, found);
  }
  return null;
}

function decorate(state, incident) {
  const kind = incidentKind(incident.kind);
  return {
    id: nextId('inc'),
    itemId: null,
    index: 0,
    demand: null,
    ...incident,
    severity: kind.severity,
    atGm: Boolean(kind.atGm),
  };
}


