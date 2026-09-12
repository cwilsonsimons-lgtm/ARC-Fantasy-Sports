// Something happens, and then everybody else decides what to do about it.
//
// Incidents come from two places. A post-match attack is tied to a match, so it
// lives here next to the bell. Everything else backstage comes out of
// `backstage-events.js`, which reads the state of the building and draws from
// it. Both feed one resolver, because what an incident *is* has nothing to do
// with what produced it.
//
// A reaction is itself an event. When somebody makes the save, the attacker's
// people get their own look at it, and so on down the chain, each link harder
// to justify than the last. That is how a two-person rivalry ends up with five
// wrestlers in it.
//
// Everything below runs whether or not the GM is standing in the room. Being
// there decides whether you get to rule on it, never whether it happened.
import { byId } from './wrestlers.js';
import { createEntry } from './journal.js';
import { resolveReaction } from './reactions.js';
import { trait, lean } from './traits.js';
import { remember } from './memory.js';
import { roomOf, peopleIn } from './backstage.js';
import { incidentKind } from '../data/backstage.js';
import { nextId } from '../ids.js';

const BASE_CHANCE = 0.10;
const MAX_CHANCE = 0.55;
const CHAIN_LIMIT = 3;

// Which kinds are somebody putting hands on somebody. Only these run the
// reaction chain — nobody sprints across the building to break up a sulk.
const PHYSICAL = new Set(['attack', 'brawl', 'ambush']);
// And which are aimed at the office rather than at another wrestler.
const AT_THE_GM = new Set(['complaint', 'storm-in', 'confrontation', 'refusal', 'walkout']);

function bond(wrestler, otherId) {
  if (!wrestler.relationships[otherId]) {
    wrestler.relationships[otherId] = { matches: 0, segments: 0, owed: 0, tie: null };
  }
  const rel = wrestler.relationships[otherId];
  // Records written before debts and ties existed have neither, and
  // `undefined + 1` is NaN, which would silently poison every later read of it.
  if (rel.owed === undefined) rel.owed = 0;
  if (rel.tie === undefined) rel.tie = null;
  return rel;
}

function grudgeFor(wrestler, targetId, type) {
  return wrestler.grudges.find(g => g.type === type && g.targetId === targetId);
}

function addGrudge(state, wrestler, targetId, type) {
  const existing = grudgeFor(wrestler, targetId, type);
  if (existing) {
    existing.week = state.week; // still being fed, so the clock restarts
    return false;
  }
  wrestler.grudges.push({ id: nextId('gr'), week: state.week, type, targetId, data: {} });
  return true;
}

// Everything an incident does to somebody is something the locker room did to
// them, so it all files under the same heading — and it all names the other
// person, which is what lets the card say who they feel that way about.
function felt(state, wrestler, amount, targetId, detail) {
  remember(state, wrestler, { source: 'peer', weight: amount, targetId, detail });
}

// Who was standing there. A thing said to your face in the locker room is a
// different thing from the same words in an empty office, and this is what
// makes the room you are in part of every decision.
export function witnesses(state, incident) {
  const room = incident.locationId ? peopleIn(state, incident.locationId) : [];
  return room.filter(w => w.id !== incident.aggressorId && w.id !== incident.victimId);
}

// Who is likely to lose their temper after the bell. Sore losers mostly, but a
// winner who wants to make a point sometimes does it too.
export function attackChance(state, item, result) {
  const [a, b] = item.participants;
  const winner = byId(state.wrestlers, result.winnerId);
  const loser = byId(state.wrestlers, result.winnerId === a ? b : a);
  if (!winner || !loser) return 0;

  const history = bond(loser, winner.id);
  // Aggression is who swings; professionalism is who does not. They are not the
  // same trait, and somebody can be both — aggressive and disciplined is a
  // wrestler who only goes when it is genuinely personal.
  const chance = BASE_CHANCE
    + Math.min(0.14, history.matches * 0.02)
    + loser.grudges.filter(g => g.targetId === winner.id).length * 0.15
    + (loser.alignment === 'Heel' ? 0.08 : 0)
    + (100 - trait(loser, 'professionalism')) / 500
    + lean(loser, 'aggression') * 0.12
    - lean(loser, 'patience') * 0.06;

  return Math.max(0, Math.min(MAX_CHANCE, chance));
}

export function maybePostMatchAttack(state, item, result, index, roll) {
  if (item.type !== 'match' || !result.winnerId) return null;
  if (roll() > attackChance(state, item, result)) return null;

  const [a, b] = item.participants;
  const winnerId = result.winnerId;
  const loserId = winnerId === a ? b : a;

  // Usually the one who just lost. Sometimes the winner making a statement.
  const aggressorId = roll() < 0.7 ? loserId : winnerId;
  const victimId = aggressorId === loserId ? winnerId : loserId;

  return {
    id: nextId('inc'), kind: 'attack', itemId: item.id,
    aggressorId, victimId, index,
    // In front of the crowd and the curtain both, which is why it is the one
    // incident the GM cannot miss no matter where they are standing.
    locationId: 'gorilla',
    severity: 'major', demand: null, atGm: false,
  };
}

// Runs the whole thing and writes it into the journal as it goes. Returns what
// it turned into, so the caller can decide whether the GM ever finds out.
export function resolveIncident(state, incident) {
  const beats = [];
  const push = (type, data) => {
    const entry = createEntry({
      week: state.week, at: incident.at || 0, type, itemId: incident.itemId, data,
    });
    state.journal.push(entry);
    beats.push(entry);
  };

  const aggressor = byId(state.wrestlers, incident.aggressorId);
  if (!aggressor) return { beats, severity: incident.severity || 'minor' };

  if (AT_THE_GM.has(incident.kind)) {
    return { beats, severity: resolveAtTheGm(state, incident, aggressor, push) };
  }

  const victim = byId(state.wrestlers, incident.victimId);
  if (!victim) return { beats, severity: incident.severity || 'minor' };

  if (!PHYSICAL.has(incident.kind)) {
    return { beats, severity: resolveWords(state, incident, aggressor, victim, push) };
  }
  return { beats, severity: resolvePhysical(state, incident, aggressor, victim, push, beats) };
}

// ---------------------------------------------------------------- words only

function resolveWords(state, incident, aggressor, victim, push) {
  push(incident.kind, {
    aggressorId: aggressor.id, victimId: victim.id, locationId: incident.locationId,
  });

  const bite = incident.kind === 'argument' ? 2 : 4;
  felt(state, victim, -bite, aggressor.id, incident.kind);
  felt(state, aggressor, -Math.round(bite / 2), victim.id, incident.kind);

  // A tie that keeps being argued over is a tie coming apart. The count that
  // made them allies is what a falling-out spends.
  if (incident.kind === 'tag-dispute' || incident.kind === 'faction-dispute') {
    const forward = bond(aggressor, victim.id);
    const back = bond(victim, aggressor.id);
    forward.segments = Math.max(0, forward.segments - 1);
    back.segments = Math.max(0, back.segments - 1);
  }

  // The room hears it. Not a grievance of their own — just the knowledge that
  // those two are not right, which is what makes booking them together a
  // decision rather than a default.
  for (const bystander of witnesses(state, incident)) {
    felt(state, bystander, -1, aggressor.id, 'saw-a-row');
  }

  return incidentKind(incident.kind).severity;
}

// ---------------------------------------------------------------- at the GM

function resolveAtTheGm(state, incident, aggressor, push) {
  push(incident.kind, {
    aggressorId: aggressor.id,
    locationId: incident.locationId,
    demand: incident.demand || null,
    itemId: incident.itemId || null,
  });

  // Bringing it to the office is itself a cost to them — it is not free to be
  // the person who makes a scene, and the more professional they are the more
  // it costs them to have done it.
  const pride = incident.kind === 'complaint' ? 1 : 3;
  remember(state, aggressor, {
    source: 'gm', weight: -pride, detail: incident.kind,
  });

  // And the room reads whoever is standing there. A confrontation in an empty
  // office is a conversation; the same words in the locker room are an event.
  const seen = witnesses(state, incident);
  if (incident.kind === 'confrontation' || incident.kind === 'storm-in') {
    for (const bystander of seen) {
      felt(state, bystander, -1, aggressor.id, 'saw-it-said');
    }
  }

  return incidentKind(incident.kind).severity;
}

// ---------------------------------------------------------------- hands on

function resolvePhysical(state, incident, aggressor, victim, push, beats) {
  push(incident.kind, {
    aggressorId: aggressor.id, victimId: victim.id, locationId: incident.locationId,
  });
  felt(state, victim, incident.kind === 'brawl' ? -3 : -4, aggressor.id, incident.kind);
  bond(victim, aggressor.id).matches += 1;
  bond(aggressor, victim.id).matches += 1;
  addGrudge(state, victim, aggressor.id, 'attacked');
  // A brawl is two people swinging, so both of them come out of it with
  // something; an ambush is one-sided and only one of them does.
  if (incident.kind === 'brawl') addGrudge(state, aggressor, victim.id, 'attacked');

  const involved = new Set([victim.id, aggressor.id]);
  let currentVictim = victim;
  let currentAggressor = aggressor;

  for (let depth = 0; depth < CHAIN_LIMIT; depth += 1) {
    const { actor, hesitator } = resolveReaction(
      state,
      {
        victimId: currentVictim.id,
        aggressorId: currentAggressor.id,
        fromIndex: incident.index || 0,
        locationId: incident.locationId,
      },
      involved,
      depth
    );

    if (actor) {
      const saver = actor.candidate;
      push(depth === 0 ? 'save' : 'escalation', {
        saverId: saver.id,
        victimId: currentVictim.id,
        aggressorId: currentAggressor.id,
        motive: actor.motive,
      });

      // Standing beside somebody counts as standing beside them, and being
      // helped is remembered as a debt.
      bond(currentVictim, saver.id).segments += 1;
      bond(saver, currentVictim.id).segments += 1;
      bond(currentVictim, saver.id).owed += 1;

      // And a debt that is repaid stops being owed. Without this, favours only
      // ever accumulate, and a roster played for a year is one where everybody
      // owes everybody and therefore everybody runs in.
      const settled = bond(saver, currentVictim.id);
      if (settled.owed > 0) settled.owed -= 1;

      bond(saver, currentAggressor.id).matches += 1;
      bond(currentAggressor, saver.id).matches += 1;
      addGrudge(state, currentAggressor, saver.id, 'attacked');

      felt(state, saver, 2, currentVictim.id, 'saved-them');
      felt(state, currentVictim, 3, saver.id, 'was-saved');

      involved.add(saver.id);
      // The rescue is the next thing somebody has to have an opinion about:
      // whoever was doing the beating is now the one being interrupted.
      currentVictim = currentAggressor;
      currentAggressor = saver;
      continue;
    }

    // Only the first look matters dramatically: somebody thinking about saving
    // the wrestler who started it is noise, not a story.
    if (hesitator && depth === 0) {
      const waverer = hesitator.candidate;
      push('hesitation', { wrestlerId: waverer.id, victimId: currentVictim.id });
      // Worse than never moving. They were seen deciding.
      felt(state, currentVictim, -7, waverer.id, 'abandoned');
      felt(state, waverer, -2, currentVictim.id, 'hesitated');
      addGrudge(state, currentVictim, waverer.id, 'abandoned');
      break;
    }

    if (depth === 0) {
      push('nobody', { victimId: currentVictim.id });
      felt(state, currentVictim, -6, null, 'nobody-came');
      // Being left there is one thing. Being left there by the person closest
      // to you is another, and that is the one that gets remembered.
      const closest = closestAvailableAlly(state, currentVictim, involved);
      if (closest) addGrudge(state, currentVictim, closest.id, 'abandoned');
    }
    break;
  }

  return severityOf(beats);
}

// How big a thing it turned into, which is what any response gets measured
// against. One person swinging is not a riot.
function severityOf(beats) {
  const escalations = beats.filter(b => b.type === 'escalation').length;
  if (escalations >= 1) return 'critical';
  if (beats.some(b => b.type === 'save')) return 'major';
  return 'moderate';
}

function closestAvailableAlly(state, wrestler, involved) {
  const ranked = Object.entries(wrestler.relationships)
    .filter(([id, rel]) => rel.segments > 0 && !involved.has(id))
    .sort((a, b) => b[1].segments - a[1].segments);
  if (!ranked.length) return null;
  const ally = byId(state.wrestlers, ranked[0][0]);
  return ally && roomOf(state, ally.id) ? ally : null;
}

export { PHYSICAL, AT_THE_GM };
