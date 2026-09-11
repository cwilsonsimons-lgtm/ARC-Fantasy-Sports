// Something happens, and then everybody else decides what to do about it.
//
// One trigger exists today: a post-match attack. It is enough to exercise the
// whole engine, and every other trigger the game grows later — a backstage
// argument, a contract signing that goes wrong — feeds the same resolver.
//
// A reaction is itself an event. When somebody makes the save, the attacker's
// people get their own look at it, and so on down the chain, each link harder
// to justify than the last. That is how a two-person rivalry ends up with five
// wrestlers in it.
import { byId } from './wrestlers.js';
import { createEntry } from './journal.js';
import { resolveReaction } from './reactions.js';
import { nextId } from '../ids.js';

const BASE_CHANCE = 0.10;
const MAX_CHANCE = 0.55;
const CHAIN_LIMIT = 3;
const ARGUMENT_CHANCE = 0.14;

function bond(wrestler, otherId) {
  if (!wrestler.relationships[otherId]) {
    wrestler.relationships[otherId] = { matches: 0, segments: 0, owed: 0 };
  }
  const rel = wrestler.relationships[otherId];
  // Records written before debts existed have no `owed`, and `undefined + 1`
  // is NaN, which would silently poison every later read of it.
  if (rel.owed === undefined) rel.owed = 0;
  return rel;
}

function grudgeFor(wrestler, targetId, type) {
  return wrestler.grudges.find(g => g.type === type && g.targetId === targetId);
}

function addGrudge(state, wrestler, targetId, type) {
  if (grudgeFor(wrestler, targetId, type)) return false;
  wrestler.grudges.push({ id: nextId('gr'), week: state.week, type, targetId, data: {} });
  return true;
}

function nudge(wrestler, amount) {
  wrestler.morale = Math.max(0, Math.min(100, Math.round(wrestler.morale + amount)));
}

// Who is likely to lose their temper after the bell. Sore losers mostly, but a
// winner who wants to make a point sometimes does it too.
export function attackChance(state, item, result) {
  const [a, b] = item.participants;
  const winner = byId(state.wrestlers, result.winnerId);
  const loser = byId(state.wrestlers, result.winnerId === a ? b : a);
  if (!winner || !loser) return 0;

  const history = bond(loser, winner.id);
  let chance = BASE_CHANCE
    + Math.min(0.14, history.matches * 0.02)
    + loser.grudges.filter(g => g.targetId === winner.id).length * 0.15
    + (loser.alignment === 'Heel' ? 0.08 : 0)
    + (100 - loser.stats.professionalism) / 500;

  return Math.min(MAX_CHANCE, chance);
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

  return { id: nextId('inc'), itemId: item.id, aggressorId, victimId, index };
}

// Not everything is a beating. Two people who already cannot stand each other
// crossing paths backstage is the small end of the scale, and the small end is
// what makes an overreaction visible as one.
export function maybeBackstageArgument(state, roll) {
  if (roll() > ARGUMENT_CHANCE) return null;

  const fit = state.wrestlers.filter(w => w.status === 'Available');
  const pairs = [];
  for (const wrestler of fit) {
    for (const [otherId, rel] of Object.entries(wrestler.relationships || {})) {
      const other = byId(state.wrestlers, otherId);
      if (!other || other.status !== 'Available') continue;
      const heat = rel.matches + wrestler.grudges.filter(g => g.targetId === otherId).length * 4;
      if (heat >= 4) pairs.push({ aggressorId: wrestler.id, victimId: otherId, heat });
    }
  }
  if (!pairs.length) return null;

  pairs.sort((a, b) => b.heat - a.heat);
  const chosen = pairs[Math.floor(roll() * Math.min(pairs.length, 5))] || pairs[0];
  return {
    id: nextId('inc'),
    kind: 'argument',
    itemId: null,
    aggressorId: chosen.aggressorId,
    victimId: chosen.victimId,
    index: 0,
  };
}

// Runs the whole chain and writes it into the journal as it goes.
export function resolveIncident(state, incident) {
  const at = state.journal.length ? incident.at || 0 : 0;
  const beats = [];
  const push = (type, data) => {
    const entry = createEntry({ week: state.week, at: incident.at || 0, type, itemId: incident.itemId, data });
    state.journal.push(entry);
    beats.push(entry);
  };

  const victim = byId(state.wrestlers, incident.victimId);
  const aggressor = byId(state.wrestlers, incident.aggressorId);
  if (!victim || !aggressor) return beats;

  if (incident.kind === 'argument') {
    push('argument', { aggressorId: aggressor.id, victimId: victim.id });
    nudge(victim, -2);
    nudge(aggressor, -1);
    return { beats, severity: 'minor' };
  }

  push('attack', { aggressorId: aggressor.id, victimId: victim.id });
  nudge(victim, -4);
  bond(victim, aggressor.id).matches += 1;
  bond(aggressor, victim.id).matches += 1;
  addGrudge(state, victim, aggressor.id, 'attacked');

  const involved = new Set([victim.id, aggressor.id]);
  let currentVictim = victim;
  let currentAggressor = aggressor;

  for (let depth = 0; depth < CHAIN_LIMIT; depth += 1) {
    const { actor, hesitator } = resolveReaction(
      state,
      { victimId: currentVictim.id, aggressorId: currentAggressor.id, fromIndex: incident.index },
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
      bond(currentVictim, saver.id).segments += 2;
      bond(saver, currentVictim.id).segments += 2;
      bond(currentVictim, saver.id).owed += 1;

      bond(saver, currentAggressor.id).matches += 1;
      bond(currentAggressor, saver.id).matches += 1;
      addGrudge(state, currentAggressor, saver.id, 'attacked');

      nudge(saver, 2);
      nudge(currentVictim, 3);

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
      nudge(currentVictim, -7);
      nudge(waverer, -2);
      addGrudge(state, currentVictim, waverer.id, 'abandoned');
      break;
    }

    if (depth === 0) {
      push('nobody', { victimId: currentVictim.id });
      nudge(currentVictim, -6);
      // Being left there is one thing. Being left there by the person closest
      // to you is another, and that is the one that gets remembered.
      const closest = closestAvailableAlly(state, currentVictim, involved);
      if (closest) addGrudge(state, currentVictim, closest.id, 'abandoned');
    }
    break;
  }

  return { beats, severity: severityOf(beats) };
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
  return ally && ally.status === 'Available' ? ally : null;
}
