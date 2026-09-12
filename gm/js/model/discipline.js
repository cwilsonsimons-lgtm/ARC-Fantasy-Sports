// Applying the GM's answer to an incident.
//
// Three things happen to every response: it lands on the people named in it, it
// lands on everyone connected to them, and it lands on the GM's own standing.
// The third is the one that accumulates — a pattern of harsh calls becomes a
// reputation, and reputations arrive before you do.
import { byId } from './wrestlers.js';
import { createEntry } from './journal.js';
import { responseById, proportionality } from '../data/responses.js';
import { DEMANDS } from '../data/backstage.js';
import { witnesses } from './incidents.js';
import { useSecurity, securityLeft } from './backstage.js';
import { trait, lean, scale } from './traits.js';
import { remember } from './memory.js';
import { alliesOf as tiedAllies } from './relationships.js';
import { nextId } from '../ids.js';

const MANAGEMENT = null; // a grudge with no target is a grudge against the office

// A ruling is yours. It files under your name, which is what makes the GM
// standing on somebody's card an account of your own decisions rather than a
// mood reading.
function ruling(state, wrestler, amount, detail) {
  if (!wrestler) return;
  remember(state, wrestler, { source: 'gm', weight: amount, detail });
}

// And what you did to their friend files under a heading of its own, because
// "you punished me" and "you punished them" are different grievances.
function onBehalfOf(state, wrestler, amount, targetId, detail) {
  if (!wrestler) return;
  remember(state, wrestler, { source: 'ally', weight: amount, targetId, detail });
}

function addGrudge(state, wrestler, targetId, type, data = {}) {
  if (wrestler.grudges.some(g => g.type === type && g.targetId === targetId)) return false;
  wrestler.grudges.push({ id: nextId('gr'), week: state.week, type, targetId, data });
  return true;
}

// Whether a hard call becomes a standing grievance against the office. Somebody
// who respects the office takes the ruling; somebody who answers to nobody has
// been waiting for a reason.
function takesItPersonally(wrestler) {
  return trait(wrestler, 'authority') < 62 + lean(wrestler, 'patience') * 12;
}

function alliesOf(state, wrestler) {
  return tiedAllies(state.wrestlers, wrestler)
    .filter(entry => entry.ally.status !== 'Unavailable');
}

function enemiesOf(state, wrestler) {
  return Object.entries(wrestler.relationships || {})
    .filter(([, rel]) => rel.matches >= 3)
    .map(([id]) => byId(state.wrestlers, id))
    .filter(Boolean);
}

// Takes somebody off the rest of tonight, and off whatever they were booked for.
function pullFromShow(state, wrestlerId) {
  const aired = new Set((state.broadcast ? state.broadcast.results : []).map(r => r.itemId));
  const pulled = state.show.items.filter(item =>
    !aired.has(item.id) && item.participants.includes(wrestlerId)
  );
  state.show.items = state.show.items.filter(item => !pulled.includes(item));
  return pulled;
}

export function applyResponse(state, incident, responseId) {
  const response = responseById(responseId);
  if (!response) return null;

  const aggressor = byId(state.wrestlers, incident.aggressorId);
  // A complaint, a confrontation or somebody refusing to go out has only one
  // wrestler in it. The other side is you, and you do not have a morale score.
  const victim = incident.victimId === 'gm' ? null : byId(state.wrestlers, incident.victimId);
  if (!aggressor) return null;

  const read = proportionality(incident.severity, responseId);
  const outcome = {
    responseId, read, pulled: [], opportunity: null, suspended: null,
    gaveIn: false, delayed: false,
  };

  // A ruling that arrives after the room has already made up its mind is worth
  // a fraction of the same ruling made on the spot. Being late is not the same
  // as being absent, but it is not the same as being there either.
  const weightOf = amount => Math.round(amount * (incident.late ? 0.5 : 1));

  // What the response does to the person it lands on.
  if (responseId === 'delay') {
    // Not a decision. A deferral, and they can tell the difference.
    ruling(state, aggressor, -3, 'delayed');
    outcome.delayed = true;
  } else if (responseId === 'giveIn') {
    // Solves this one completely and tells the building how to get what it
    // wants. That second part is the price, and it is not paid tonight.
    ruling(state, aggressor, 12, `gave-in:${incident.demand || 'demand'}`);
    outcome.gaveIn = true;
    outcome.demand = incident.demand || null;
    for (const bystander of witnesses(state, incident)) {
      remember(state, bystander, { source: 'gm', weight: -2, detail: 'watched-you-fold' });
    }
  } else if (responseId === 'word') {
    ruling(state, aggressor, weightOf(3), 'word');
  } else if (responseId === 'mediate') {
    // Two people who already wanted to fight, in one room. Whether it works is
    // a question about both of them, not about the idea.
    const calmed = victim
      && (trait(aggressor, 'professionalism') + trait(victim, 'professionalism')) / 2
        >= 55 - lean(aggressor, 'patience') * 10;
    ruling(state, aggressor, calmed ? 4 : -3, 'mediate');
    if (victim) ruling(state, victim, calmed ? 4 : -3, 'mediate');
    outcome.mediationWorked = Boolean(calmed);
  } else if (responseId === 'security') {
    // Security is two people for a whole building. Spending them here is
    // spending them, and the next thing tonight will find out.
    useSecurity(state);
    ruling(state, aggressor, weightOf(-2), 'security');
    outcome.securityLeft = securityLeft(state);
  } else if (responseId === 'warning') {
    ruling(state, aggressor, weightOf(-4), 'warning');
  } else if (response.suspendWeeks !== undefined) {
    outcome.suspended = applySuspension(state, aggressor, response.suspendWeeks, weightOf);
    outcome.pulled = pullFromShow(state, aggressor.id);
  }

  // A punishment the room reads as unfair is remembered as yours, not theirs —
  // though whether it becomes a standing grievance depends on what the person
  // thinks of the office in the first place.
  if (read === 'harsh' && response.weight >= 2) {
    if (takesItPersonally(aggressor)) {
      addGrudge(state, aggressor, MANAGEMENT, 'punished', { responseId, severity: incident.severity });
    }
    for (const { ally, weight } of alliesOf(state, aggressor)) {
      // Loyalty is the trait that decides whether your treatment of somebody
      // else is any of their business.
      const felt = Math.min(6, weight) * scale(ally, 'loyalty', 0.8);
      onBehalfOf(state, ally, -felt, aggressor.id, 'punished');
      if (weight >= 4 && takesItPersonally(ally)) {
        addGrudge(state, ally, MANAGEMENT, 'punished', { onBehalfOf: aggressor.id });
      }
    }
  }

  // And one the room reads as nothing at all is remembered too.
  if (read === 'weak' && victim) {
    ruling(state, victim, -4, 'let-go');
    for (const wrestler of state.wrestlers) {
      if (wrestler.status === 'Available' && trait(wrestler, 'professionalism') > 70) {
        ruling(state, wrestler, -1, 'let-go');
      }
    }
  }

  if (read === 'fair' && response.weight > 0 && victim) {
    ruling(state, victim, 3, 'backed-up');
  }

  // People who cannot stand the punished wrestler enjoy this.
  if (response.weight >= 3) {
    for (const enemy of enemiesOf(state, aggressor)) {
      remember(state, enemy, { source: 'peer', weight: 2, targetId: aggressor.id, detail: 'got-what-they-had-coming' });
    }
  }

  state.gmRecord = state.gmRecord || {};
  const record = state.gmRecord;
  for (const key of ['harsh', 'weak', 'fair', 'ignored', 'booked', 'gaveIn', 'delayed', 'missed']) {
    if (record[key] === undefined) record[key] = 0;
  }
  // The three ways of not making a call are counted apart from the calls,
  // because authority reads them differently: letting it go, putting it off,
  // and handing over what was asked for are not the same failure.
  if (responseId === 'ignore') record.ignored += 1;
  else if (responseId === 'delay') record.delayed += 1;
  else if (responseId === 'giveIn') record.gaveIn += 1;
  else record[read] += 1;
  if (responseId === 'bookTonight' || responseId === 'bookNext') record.booked += 1;

  state.journal.push(createEntry({
    week: state.week,
    at: incident.at || 0,
    type: 'ruling',
    data: {
      responseId,
      read,
      aggressorId: aggressor.id,
      victimId: victim ? victim.id : null,
      kind: incident.kind || 'attack',
      late: Boolean(incident.late),
      demand: outcome.demand || null,
      pulled: outcome.pulled.length,
      suspended: outcome.suspended,
      mediationWorked: outcome.mediationWorked,
    },
  }));

  return outcome;
}

// The ladder, from sending somebody home for the night to telling them not to
// come back until they hear from you. The gap between the rungs is the point:
// every step up buys obedience and spends goodwill, and the room is watching
// which rung you reach for.
function applySuspension(state, wrestler, weeks, weightOf) {
  if (weeks === 'indefinite') {
    ruling(state, wrestler, weightOf(-26), 'suspend-indefinite');
    wrestler.status = 'Unavailable';
    wrestler.suspendedUntil = 'indefinite';
    return 'indefinite';
  }

  if (!weeks) {
    // Tonight only. They are out of the building and off the rest of the card.
    ruling(state, wrestler, weightOf(-9), 'sent-home');
    return 0;
  }

  ruling(state, wrestler, weightOf(-8 - weeks * 3), 'suspend');
  wrestler.status = 'Unavailable';
  wrestler.suspendedUntil = state.week + weeks;
  return weeks;
}

// Bringing somebody back in. Only an indefinite suspension needs this — every
// other length ends on its own — which is exactly what makes it different.
export function reinstate(state, wrestlerId) {
  const wrestler = byId(state.wrestlers, wrestlerId);
  if (!wrestler || wrestler.suspendedUntil !== 'indefinite') return null;
  wrestler.suspendedUntil = null;
  wrestler.status = 'Available';
  remember(state, wrestler, { source: 'gm', weight: 7, detail: 'brought-back' });
  return wrestler;
}

export function indefinitelySuspended(state) {
  return state.wrestlers.filter(w => w.suspendedUntil === 'indefinite');
}

// Injuries end too, and on their own. The only reason this sits apart from a
// suspension is that one of them is something you did to somebody.
export function healInjuries(state) {
  for (const wrestler of state.wrestlers) {
    if (!wrestler.injuredUntil) continue;
    if (state.week < wrestler.injuredUntil) continue;
    wrestler.injuredUntil = null;
    if (wrestler.status === 'Injured') wrestler.status = 'Available';
    remember(state, wrestler, { source: 'gm', weight: 2, detail: 'cleared-to-work' });
  }
}

// Suspensions end. Being suspended does not stop being remembered.
export function releaseSuspensions(state) {
  for (const wrestler of state.wrestlers) {
    if (wrestler.suspendedUntil === 'indefinite') continue; // ends when you say so
    if (wrestler.suspendedUntil && state.week >= wrestler.suspendedUntil) {
      wrestler.suspendedUntil = null;
      if (wrestler.status === 'Unavailable') wrestler.status = 'Available';
    }
  }
}

const LABELS = [
  { id: 'disciplinarian', label: 'The Disciplinarian', blurb: 'They behave around you. They also talk about you.' },
  { id: 'pushover', label: 'The Wild West GM', blurb: 'Great television. Nobody is frightened of you.' },
  { id: 'matchmaker', label: 'The Matchmaker', blurb: 'Bring a problem to this office and it becomes a match.' },
  { id: 'absent', label: 'The Absentee', blurb: 'Things happen and you let them.' },
  { id: 'evenhanded', label: 'An even hand', blurb: 'The room thinks you call it about right.' },
];

// Not chosen at the start. Earned, from the pattern of what you actually do.
export function gmReputation(state) {
  const record = state.gmRecord || { harsh: 0, weak: 0, fair: 0, ignored: 0, booked: 0 };
  const total = record.harsh + record.weak + record.fair + record.ignored;
  if (total < 3) return null;

  if (record.booked >= 3 && record.booked >= total * 0.4) return LABELS[2];
  if (record.harsh > record.fair && record.harsh >= total * 0.4) return LABELS[0];
  if (record.ignored >= total * 0.5) return LABELS[3];
  if (record.weak > record.fair && record.weak >= total * 0.4) return LABELS[1];
  return LABELS[4];
}
