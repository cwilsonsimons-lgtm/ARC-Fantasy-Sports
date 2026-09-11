// Applying the GM's answer to an incident.
//
// Three things happen to every response: it lands on the people named in it, it
// lands on everyone connected to them, and it lands on the GM's own standing.
// The third is the one that accumulates — a pattern of harsh calls becomes a
// reputation, and reputations arrive before you do.
import { byId } from './wrestlers.js';
import { createEntry } from './journal.js';
import { responseById, proportionality } from '../data/responses.js';
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
  const victim = byId(state.wrestlers, incident.victimId);
  if (!aggressor || !victim) return null;

  const read = proportionality(incident.severity, responseId);
  const outcome = { responseId, read, pulled: [], opportunity: null, suspended: null };

  // What the response does to the person it lands on.
  if (responseId === 'word') {
    ruling(state, aggressor, 3, 'word');
  } else if (responseId === 'mediate') {
    // Two people who already wanted to fight, in one room. Whether it works is
    // a question about both of them, not about the idea.
    const calmed = (trait(aggressor, 'professionalism') + trait(victim, 'professionalism')) / 2
      >= 55 - lean(aggressor, 'patience') * 10;
    ruling(state, aggressor, calmed ? 4 : -3, 'mediate');
    ruling(state, victim, calmed ? 4 : -3, 'mediate');
    outcome.mediationWorked = calmed;
  } else if (responseId === 'security') {
    ruling(state, aggressor, -2, 'security');
  } else if (responseId === 'warning') {
    ruling(state, aggressor, -4, 'warning');
  } else if (responseId === 'eject') {
    ruling(state, aggressor, -9, 'eject');
    outcome.pulled = pullFromShow(state, aggressor.id);
  } else if (response.suspendWeeks) {
    ruling(state, aggressor, -8 - response.suspendWeeks * 3, 'suspend');
    outcome.pulled = pullFromShow(state, aggressor.id);
    aggressor.status = 'Unavailable';
    aggressor.suspendedUntil = state.week + response.suspendWeeks;
    outcome.suspended = response.suspendWeeks;
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
  if (read === 'weak') {
    ruling(state, victim, -4, 'let-go');
    for (const wrestler of state.wrestlers) {
      if (wrestler.status === 'Available' && trait(wrestler, 'professionalism') > 70) {
        ruling(state, wrestler, -1, 'let-go');
      }
    }
  }

  if (read === 'fair' && response.weight > 0) {
    ruling(state, victim, 3, 'backed-up');
  }

  // People who cannot stand the punished wrestler enjoy this.
  if (response.weight >= 3) {
    for (const enemy of enemiesOf(state, aggressor)) {
      remember(state, enemy, { source: 'peer', weight: 2, targetId: aggressor.id, detail: 'got-what-they-had-coming' });
    }
  }

  state.gmRecord = state.gmRecord || { harsh: 0, weak: 0, fair: 0, ignored: 0, booked: 0 };
  if (responseId === 'ignore') state.gmRecord.ignored += 1;
  else state.gmRecord[read] += 1;
  if (responseId === 'bookTonight' || responseId === 'bookNext') state.gmRecord.booked += 1;

  state.journal.push(createEntry({
    week: state.week,
    at: incident.at || 0,
    type: 'ruling',
    data: {
      responseId,
      read,
      aggressorId: aggressor.id,
      victimId: victim.id,
      pulled: outcome.pulled.length,
      suspended: outcome.suspended,
      mediationWorked: outcome.mediationWorked,
    },
  }));

  return outcome;
}

// Suspensions end. Being suspended does not stop being remembered.
export function releaseSuspensions(state) {
  for (const wrestler of state.wrestlers) {
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
