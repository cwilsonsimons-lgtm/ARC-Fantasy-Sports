// Something happens, and then everybody else decides what to do about it.
//
// Incidents come from two places: `post-match.js` decides what the bell
// produces, and `backstage-events.js` reads the state of the building and draws
// from it. Both feed the one resolver below, because what an incident *is* has
// nothing to do with what produced it — and because a chain of reactions should
// run the same way whether it started in the ring or in a corridor.
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
import { remember } from './memory.js';
import { roomOf, peopleIn } from './backstage.js';
import { noteThread } from './threads.js';
import { incidentKind } from '../data/backstage.js';
import { nextId } from '../ids.js';

const CHAIN_LIMIT = 3;

// Which kinds are somebody putting hands on somebody. Only these run the
// reaction chain — nobody sprints across the building to break up a sulk.
const PHYSICAL = new Set(['attack', 'brawl', 'ambush', 'submission-held', 'faction-beatdown']);
// And which are over before anybody could have got there. A cheap shot on the
// way out is a real thing that happened and nobody's chance to be a hero.
const QUICK = new Set(['cheap-shot']);
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

  if (QUICK.has(incident.kind)) {
    return { beats, severity: resolveQuick(state, incident, aggressor, victim, push) };
  }
  if (!PHYSICAL.has(incident.kind)) {
    return { beats, severity: resolveWords(state, incident, aggressor, victim, push) };
  }
  return { beats, severity: resolvePhysical(state, incident, aggressor, victim, push, beats) };
}

// ---------------------------------------------------------------- over at once

// One shot, and then they are walking to the back. Everything a full attack
// does to the record, and nobody gets the chance to come out for it.
function resolveQuick(state, incident, aggressor, victim, push) {
  push(incident.kind, {
    aggressorId: aggressor.id, victimId: victim.id, locationId: incident.locationId,
  });
  felt(state, victim, -3, aggressor.id, incident.kind);
  bond(victim, aggressor.id).matches += 1;
  bond(aggressor, victim.id).matches += 1;
  addGrudge(state, victim, aggressor.id, 'attacked');
  noteThread(state, aggressor.id, victim.id, incident.kind, incident.at || 0);
  return incidentKind(incident.kind).severity || 'minor';
}

// ---------------------------------------------------------------- words only

function resolveWords(state, incident, aggressor, victim, push) {
  push(incident.kind, {
    aggressorId: aggressor.id, victimId: victim.id, locationId: incident.locationId,
  });

  noteThread(state, aggressor.id, victim.id, incident.kind, incident.at || 0);
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
  const crewIds = (incident.crewIds || []).filter(id => byId(state.wrestlers, id));

  push(incident.kind, {
    aggressorId: aggressor.id, victimId: victim.id, locationId: incident.locationId,
    crewIds: crewIds.length ? crewIds : null,
  });
  felt(state, victim, bite(incident, crewIds), aggressor.id, incident.kind);
  hostility(state, victim, aggressor);
  addGrudge(state, victim, aggressor.id, 'attacked');
  noteThread(state, aggressor.id, victim.id, incident.kind, incident.at || 0);
  // A brawl is two people swinging, so both of them come out of it with
  // something; an ambush is one-sided and only one of them does.
  if (incident.kind === 'brawl') addGrudge(state, aggressor, victim.id, 'attacked');

  const involved = new Set([victim.id, aggressor.id]);

  // Everyone who came with them. Being held down by three people is its own
  // grievance against each of the three, and the one thing that makes a
  // beatdown different from a beating.
  for (const id of crewIds) {
    const member = byId(state.wrestlers, id);
    if (!member) continue;
    involved.add(id);
    hostility(state, victim, member);
    addGrudge(state, victim, id, 'attacked');
    noteThread(state, id, victim.id, 'faction-beatdown', incident.at || 0);
    felt(state, victim, -2, id, 'held-me-down');
  }

  let currentVictim = victim;
  let currentAggressor = aggressor;

  for (let depth = 0; depth < CHAIN_LIMIT; depth += 1) {
    const { actor, crew, hesitator, balker, peacemaker } = resolveReaction(
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

    // Somebody with no side to take, walking between them. This is how a chain
    // ends: not because a counter ran out, but because the locker room contains
    // an adult and they have had enough.
    if (peacemaker) {
      const referee = peacemaker.candidate;
      push('broke-it-up', {
        wrestlerId: referee.id,
        victimId: currentVictim.id,
        aggressorId: currentAggressor.id,
      });
      felt(state, currentVictim, 2, referee.id, 'stepped-between');
      felt(state, currentAggressor, -1, referee.id, 'stepped-between');
      noteThread(state, referee.id, currentAggressor.id, 'broke-it-up', incident.at || 0);
      break;
    }

    if (actor) {
      const saver = actor.candidate;
      const withThem = (crew || []).filter(member => !involved.has(member.id));
      push(depth === 0 ? 'save' : 'escalation', {
        saverId: saver.id,
        victimId: currentVictim.id,
        aggressorId: currentAggressor.id,
        motive: actor.motive,
        withIds: withThem.length ? withThem.map(w => w.id) : null,
      });

      repay(state, saver, currentVictim);
      hostility(state, saver, currentAggressor);
      addGrudge(state, currentAggressor, saver.id, 'attacked');
      noteThread(state, saver.id, currentVictim.id, 'save', incident.at || 0);
      noteThread(state, saver.id, currentAggressor.id, 'brawl', incident.at || 0);

      felt(state, saver, 2, currentVictim.id, 'saved-them');
      felt(state, currentVictim, 3, saver.id, 'was-saved');
      involved.add(saver.id);

      // A faction does not send a representative. Whoever comes with them is
      // standing beside the victim too, and in front of the same attacker.
      for (const member of withThem) {
        involved.add(member.id);
        repay(state, member, currentVictim);
        hostility(state, member, currentAggressor);
        felt(state, member, 1, currentVictim.id, 'came-with-them');
        felt(state, currentVictim, 1, member.id, 'came-for-me');
      }

      // The rescue is the next thing somebody has to have an opinion about:
      // whoever was doing the beating is now the one being interrupted.
      currentVictim = currentAggressor;
      currentAggressor = saver;
      continue;
    }

    // Only the first look matters dramatically: somebody thinking about saving
    // the wrestler who started it is noise, not a story.
    if (depth > 0) break;

    if (hesitator) {
      const waverer = hesitator.candidate;
      push('hesitation', { wrestlerId: waverer.id, victimId: currentVictim.id });
      // Worse than never moving. They were seen deciding.
      felt(state, currentVictim, -7, waverer.id, 'abandoned');
      felt(state, waverer, -2, currentVictim.id, 'hesitated');
      addGrudge(state, currentVictim, waverer.id, 'abandoned');
      noteThread(state, waverer.id, currentVictim.id, 'abandoned', incident.at || 0);
      break;
    }

    // Worse again, and the quietest thing in the game: somebody who had every
    // reason to go, and whose nerve was the only thing that decided it. They
    // did not come out and change their mind. They never moved.
    if (balker) {
      const coward = balker.candidate;
      push('balked', {
        wrestlerId: coward.id, victimId: currentVictim.id, motive: balker.motive,
      });
      felt(state, currentVictim, -8, coward.id, 'abandoned');
      felt(state, coward, -4, currentVictim.id, 'balked');
      addGrudge(state, currentVictim, coward.id, 'abandoned');
      noteThread(state, coward.id, currentVictim.id, 'abandoned', incident.at || 0);
      break;
    }

    push('nobody', { victimId: currentVictim.id });
    felt(state, currentVictim, -6, null, 'nobody-came');
    // Being left there is one thing. Being left there by the person closest
    // to you is another, and that is the one that gets remembered.
    const closest = closestAvailableAlly(state, currentVictim, involved);
    if (closest) {
      addGrudge(state, currentVictim, closest.id, 'abandoned');
      noteThread(state, closest.id, currentVictim.id, 'abandoned', incident.at || 0);
    }
    break;
  }

  return severityOf(beats, crewIds.length);
}

// How hard the opening lands. Three people is not three times one person, but
// it is not one person either.
function bite(incident, crewIds) {
  if (incident.kind === 'faction-beatdown') return -8 - crewIds.length;
  if (incident.kind === 'submission-held') return -9;
  if (incident.kind === 'brawl') return -3;
  return -4;
}

function hostility(state, a, b) {
  bond(a, b.id).matches += 1;
  bond(b, a.id).matches += 1;
}

// Standing beside somebody counts as standing beside them, and being helped is
// remembered as a debt — while a debt that is repaid stops being owed. Without
// that second half, favours only ever accumulate and a roster played for a year
// is one where everybody owes everybody and therefore everybody runs in.
function repay(state, saver, rescued) {
  bond(rescued, saver.id).segments += 1;
  bond(saver, rescued.id).segments += 1;
  bond(rescued, saver.id).owed += 1;
  const settled = bond(saver, rescued.id);
  if (settled.owed > 0) settled.owed -= 1;
}

// How big a thing it turned into, which is what any response gets measured
// against. One person swinging is not a riot.
function severityOf(beats, crewSize = 0) {
  const escalations = beats.filter(b => b.type === 'escalation').length;
  if (escalations >= 1 || crewSize >= 2) return 'critical';
  if (beats.some(b => b.type === 'save')) return 'major';
  // Somebody stepping between them before it spread is the one outcome that
  // makes a thing smaller than it was going to be.
  if (beats.some(b => b.type === 'broke-it-up')) return 'moderate';
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
