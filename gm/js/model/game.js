// Operations that span the whole game state — the weekly phase machine.
//
//   prep   book the card for this week's show
//   live   the show is on the air
//   after  the show is over; review it, then advance to next week
//
// Phase is stored rather than derived from whether a broadcast exists, so a
// future phase (the week between shows) slots in without every screen having
// to re-derive where it is. The transitions below are the only places phase
// changes, which keeps the machine in one readable file.
import { createShow } from './show.js';
import { createBroadcast, completeCurrent, currentItem, elapsedMinutes } from './broadcast.js';
import { createEntry } from './journal.js';
import { settleShow } from './morale.js';
import { decideWinner, applyOutcome } from './matches.js';
import { rngFor } from './random.js';
import { maybePostMatchAttack, maybeBackstageArgument, resolveIncident } from './incidents.js';
import { applyResponse, releaseSuspensions } from './discipline.js';
import { createOpportunity, ageOpportunities } from './opportunities.js';
import { RESPONSES } from '../data/responses.js';
import { createNetwork, runtimeFor, awardTrust } from './network.js';
import { reviewShow } from './executives.js';
import { createMatch, addItem, remainingMinutes } from './show.js';

export const PHASES = { PREP: 'prep', LIVE: 'live', AFTER: 'after' };

export function createGame({ wrestlers, promotion }) {
  return {
    week: 1,
    phase: PHASES.PREP,
    promotion,
    wrestlers,
    network: createNetwork(),
    show: createShow({ name: promotion.show }),
    broadcast: null,
    journal: [],
    pendingIncident: null,
    lastReview: null,
    opportunities: [],
    gmRecord: { harsh: 0, weak: 0, fair: 0, ignored: 0, booked: 0 },
  };
}

// The card is only editable while preparing. During the show and afterwards it
// is the record of what was planned, so nothing may rewrite it.
export function canEditCard(state) {
  return state.phase === PHASES.PREP;
}

export function startShow(state) {
  if (state.phase !== PHASES.PREP || !state.show.items.length) return false;
  state.broadcast = createBroadcast(state.show);
  state.journal = [createEntry({ week: state.week, at: 0, type: 'show-start' })];
  state.phase = PHASES.LIVE;
  return true;
}

export function completeSegment(state) {
  // The show does not move while something is waiting on the GM.
  if (state.phase !== PHASES.LIVE || state.pendingIncident) return null;

  const item = currentItem(state.show, state.broadcast);
  if (!item) return null;

  const result = completeCurrent(state.show, state.broadcast);
  const at = elapsedMinutes(state.broadcast);

  // Matches are contests: the card says who meets, the night says who wins.
  const winnerId = decideWinner(state.wrestlers, item);
  if (winnerId) {
    result.winnerId = winnerId;
    applyOutcome(state.wrestlers, item, winnerId);
  }

  state.journal.push(createEntry({
    week: state.week,
    at,
    type: 'segment-complete',
    itemId: item.id,
    data: {
      plannedMinutes: item.plannedMinutes,
      actualMinutes: result.actualMinutes,
      winnerId: winnerId || null,
    },
  }));

  // The bell rings, and then somebody decides what to do about it. The locker
  // room reacts on its own — that happens in the moment, not on the GM's word —
  // and then the situation is handed over.
  const roll = rngFor(state);
  const incident = maybePostMatchAttack(state, item, result, state.show.items.indexOf(item), roll)
    || maybeBackstageArgument(state, roll);

  if (incident) {
    incident.at = at;
    const { severity } = resolveIncident(state, incident);
    state.pendingIncident = { ...incident, severity };
    return result; // the show holds here until the GM answers
  }

  finishIfDone(state, at);
  return result;
}

// Which answers are on the table right now.
export function availableResponses(state) {
  if (!state.pendingIncident) return [];
  const room = remainingMinutes(state.show, state.broadcast);
  return RESPONSES.filter(response => !response.needsRuntime || room >= 10);
}

export function resolveIncidentResponse(state, responseId) {
  const incident = state.pendingIncident;
  if (!incident) return null;

  const outcome = applyResponse(state, incident, responseId);
  if (!outcome) return null;

  if (responseId === 'bookTonight') {
    outcome.booked = bookIncidentMatch(state, incident);
  } else if (responseId === 'bookNext') {
    outcome.opportunity = createOpportunity(state, {
      aggressorId: incident.aggressorId,
      victimId: incident.victimId,
      reason: incident.kind === 'argument' ? 'a backstage argument' : 'a post-match attack',
      promised: true,
    });
  } else if (!outcome.suspended && outcome.mediationWorked !== true) {
    // Anything left unresolved is still sitting there to be used.
    outcome.opportunity = createOpportunity(state, {
      aggressorId: incident.aggressorId,
      victimId: incident.victimId,
      reason: incident.kind === 'argument' ? 'a backstage argument' : 'a post-match attack',
    });
  }

  state.pendingIncident = null;
  finishIfDone(state, incident.at || 0);
  return outcome;
}

// Slotted in ahead of whatever was closing the show.
function bookIncidentMatch(state, incident, minutes = 10) {
  const item = createMatch({
    wrestlerAId: incident.aggressorId,
    wrestlerBId: incident.victimId,
    plannedMinutes: minutes,
  });
  const aired = new Set(state.broadcast.results.map(r => r.itemId));
  const remaining = state.show.items.filter(i => !aired.has(i.id));

  if (remaining.length > 1) {
    state.show.items.splice(state.show.items.indexOf(remaining[remaining.length - 1]), 0, item);
  } else {
    addItem(state.show, item);
  }
  return item;
}

function finishIfDone(state, at) {
  if (currentItem(state.show, state.broadcast)) return;
  state.journal.push(createEntry({ week: state.week, at, type: 'show-end' }));
  // The locker room reacts once, when the show comes off the air.
  settleShow(state);

  // And then the people upstairs decide whether you have earned more of their
  // airtime. Graded once and stored, so the post-show reads the same number it
  // actually awarded.
  const review = reviewShow(state);
  const award = awardTrust(state, review.grade);
  state.lastReview = { ...review, ...award };
  if (award.promoted) {
    state.journal.push(createEntry({
      week: state.week, at, type: 'window-extended',
      data: { minutes: award.promoted.minutes },
    }));
  }

  state.phase = PHASES.AFTER;
}

// The journal is deliberately per-show: it is cleared when the next show goes
// on the air, not here, so last week's record is still readable while the new
// card is being built. Memory that has to survive across weeks belongs on the
// wrestlers themselves, not in here.
export function advanceWeek(state) {
  if (state.phase !== PHASES.AFTER) return false;
  state.week += 1;
  releaseSuspensions(state);
  ageOpportunities(state);
  state.show = createShow({ name: state.promotion.show, runtimeMinutes: runtimeFor(state) });
  state.broadcast = null;
  state.phase = PHASES.PREP;
  return true;
}
