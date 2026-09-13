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
import { byId } from './wrestlers.js';
import { nextId } from '../ids.js';
import { remember, fadeMemories, coolGrudges } from './memory.js';
import { formTies } from './relationships.js';
import { growFamiliarity } from './stats.js';
import { createShow } from './show.js';
import { createBroadcast, completeCurrent, currentItem, elapsedMinutes } from './broadcast.js';
import { createEntry } from './journal.js';
import { settleShow } from './morale.js';
import { decideWinner, decideFall, applyOutcome, teamsOf } from './matches.js';
import { rngFor } from './random.js';
import { resolveIncident } from './incidents.js';
import { resolvePostMatch } from './post-match.js';
import { noteThread, forgetColdThreads } from './threads.js';
import { troubleIn, drawIncident } from './backstage-events.js';
import {
  START_LOCATION, TALK_MINUTES, createClock, minutesLeft, canSpend, spend, nowAt,
  placeEveryone, shuffleRooms, roomOf, peopleIn, visibility, resetSecurity, securityLeft,
} from './backstage.js';
import { walkMinutes, locationName } from '../data/locations.js';
import { applyResponse, releaseSuspensions, healInjuries } from './discipline.js';
import { createOpportunity, ageOpportunities } from './opportunities.js';
import { RESPONSES } from '../data/responses.js';
import { hasTwoSides, incidentKind, carryOf, DEMANDS } from '../data/backstage.js';
import { createNetwork, awardTrust } from './network.js';
import { seedTitles, titleById, settleTitleMatch, championMorale } from './titles.js';
import {
  archiveWeek, loadScheduled, checkBreaches, runtimeForWeek, showNameFor, isPpvWeek,
} from './calendar.js';
import { reviewShow } from './executives.js';
import { createProgression, pointsEarnedBy, xpForShow, awardXp } from './progression.js';
import { createFinance, settleWeek } from './finance.js';
import { createMatch, addItem, remainingMinutes } from './show.js';

export const PHASES = { PREP: 'prep', LIVE: 'live', AFTER: 'after' };

// A GM who starts above level one starts with the points that level would have
// paid out, and nothing else: no XP banked, no upgrades chosen, and week one is
// still week one. It is a dial on how much of the board you begin with rather
// than a fast-forward through the job.
function startingProgression(setup) {
  const gm = createProgression();
  const level = setup && setup.level ? Math.max(1, Math.min(30, Math.round(setup.level))) : 1;
  if (level > 1) {
    gm.level = level;
    gm.points = pointsEarnedBy(level);
  }
  return gm;
}

export function createGame({ wrestlers, promotion, air, titles = [], setup = null }) {
  return {
    week: 1,
    phase: PHASES.PREP,
    promotion,
    startDate: air.startDate,
    airNight: air.airNight,
    wrestlers,
    titles,
    network: createNetwork(),
    show: createShow({ name: promotion.show }),
    broadcast: null,
    journal: [],
    pendingIncident: null,
    alerts: [],
    missed: [],
    location: START_LOCATION,
    whereabouts: {},
    clock: null,
    security: { used: 0 },
    lastReview: null,
    opportunities: [],
    threads: [],
    scheduled: [],
    history: [],
    breaches: 0,
    gmRecord: {
      harsh: 0, weak: 0, fair: 0, ignored: 0, booked: 0,
      gaveIn: 0, delayed: 0, missed: 0,
    },
    gm: startingProgression(setup),
    finance: createFinance(setup ? setup.budget : undefined),
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
  // Things happen between shows — a promise goes cold, two people become a tag
  // team — and they are filed with the new week's number. Wiping the journal
  // wholesale here threw all of that away before anybody could read it, which
  // made every between-weeks event invisible: it was written, archived nowhere,
  // and gone. Keep this week's entries and start the night after them.
  state.journal = [
    ...state.journal.filter(entry => entry.week === state.week),
    createEntry({ week: state.week, at: 0, type: 'show-start' }),
  ];
  state.phase = PHASES.LIVE;

  // The GM starts at the curtain, because that is where you are when the show
  // goes on the air. Everything after that is a choice.
  const roll = rngFor(state);
  state.location = START_LOCATION;
  state.alerts = [];
  state.missed = [];
  resetSecurity(state);
  state.sawYou = [];
  state.spokenTo = [];
  placeEveryone(state, roll);
  openTheGap(state);
  noteWhoSawYou(state);
  return true;
}

// The clock between segments is the segment itself: whatever is on air runs for
// its planned time, and that is how long the GM has backstage before the next
// one starts. Booking a card of five-minute matches is booking yourself a night
// with no room to manage anybody.
//
// The trouble in the gap is decided here, up front, from how long the gap is —
// not from what the GM does with it. Whether they spend the twenty minutes
// walking to the car park or standing at the curtain, the same night happens;
// all their choice changes is which of it they are in the room for.
function openTheGap(state) {
  const item = currentItem(state.show, state.broadcast);
  const minutes = item ? item.plannedMinutes : 0;
  state.clock = createClock(minutes);
  state.clock.pending = item ? troubleIn(state, minutes, rngFor(state)) : [];
}

// Spend minutes, and let the night happen across them.
//
// Anybody standing where the GM is standing while it passes has seen them
// tonight. That register is the reason walking the building is worth the
// minutes even when nothing is going wrong: a locker room that never lays eyes
// on you all night forms a view about that.
function advanceClock(state, minutes) {
  if (!state.clock) return 0;
  noteWhoSawYou(state);
  const taken = spend(state, minutes);
  fireTrouble(state, state.clock.spent);
  noteWhoSawYou(state);
  return taken;
}

function noteWhoSawYou(state) {
  state.sawYou = state.sawYou || [];
  for (const wrestler of peopleIn(state, state.location)) {
    if (!state.sawYou.includes(wrestler.id)) state.sawYou.push(wrestler.id);
  }
}

// Applied once, when the show comes off the air. Being around is not a
// favour — it is the job — so it is worth a little, and never being seen at all
// is worth rather more in the other direction.
function settlePresence(state) {
  const seen = new Set(state.sawYou || []);
  const spoken = new Set(state.spokenTo || []);
  for (const wrestler of state.wrestlers) {
    if (!roomOf(state, wrestler.id) && !seen.has(wrestler.id)) continue;
    if (spoken.has(wrestler.id)) continue; // already paid for, and more
    remember(state, wrestler, {
      source: 'gm',
      weight: seen.has(wrestler.id) ? 1 : -2,
      detail: seen.has(wrestler.id) ? 'you-were-about' : 'never-saw-you',
    });
  }
}

// Everything scheduled for a minute we have now reached. One at a time: the
// moment something needs an answer the GM stops walking, and the rest of the
// gap is still waiting when they are done.
function fireTrouble(state, upTo) {
  const marks = (state.clock && state.clock.pending) || [];
  while (marks.length && marks[0] <= upTo) {
    marks.shift();
    if (state.pendingIncident) return;
    const incident = drawIncident(state, rngFor(state));
    if (!incident) continue;
    incident.at = nowAt(state);
    raise(state, incident);
    if (state.pendingIncident) return;
  }
}

export function completeSegment(state) {
  // The show does not move while something is waiting on the GM.
  if (state.phase !== PHASES.LIVE || state.pendingIncident) return null;

  const item = currentItem(state.show, state.broadcast);
  if (!item) return null;

  // Whatever the GM did not spend, the night did. Anything still scheduled for
  // this gap happens now, wherever they were standing while it did.
  if (state.clock) {
    state.clock.spent = state.clock.segmentMinutes;
    fireTrouble(state, state.clock.segmentMinutes);
    if (state.pendingIncident) return null; // it caught them before the bell
  }

  // Something in that gap can take the item off the card — somebody refusing to
  // go out with nobody there to make them — and then there is no segment left
  // to complete.
  if (!currentItem(state.show, state.broadcast)) {
    finishIfDone(state, elapsedMinutes(state.broadcast));
    return null;
  }

  const result = completeCurrent(state.show, state.broadcast);
  const at = elapsedMinutes(state.broadcast);

  // One generator for the whole night, and its position lives on the save, so a
  // show rolls the same way after a reload — results included, not just
  // incidents.
  const roll = rngFor(state);

  // Matches are contests: the card says who meets, the night says who wins —
  // and then, separately, who the result goes against. In anything with more
  // than two sides those are different questions, because only one person takes
  // the fall and the rest merely did not win.
  const winnerIds = decideWinner(state.wrestlers, item, roll());
  if (winnerIds.length) {
    const fallIds = decideFall(state.wrestlers, item, winnerIds, roll());
    result.winnerIds = winnerIds;
    result.winnerId = winnerIds[0]; // the side's first name, for anything reading one winner
    result.fallIds = fallIds;
    applyOutcome(state.wrestlers, item, winnerIds, fallIds);
  }

  state.journal.push(createEntry({
    week: state.week,
    at,
    type: 'segment-complete',
    itemId: item.id,
    data: {
      plannedMinutes: item.plannedMinutes,
      actualMinutes: result.actualMinutes,
      winnerId: result.winnerId || null,
      winnerIds: result.winnerIds || null,
    },
  }));

  // Two people having a match is the quietest thing that can go on a record,
  // and the thing every feud is mostly made of. Only across sides: your own
  // partner in a six-person tag is not somebody you had a match with, and a
  // battle royal would otherwise file a hundred and fifty of these at once.
  if (item.type === 'match') {
    const sides = teamsOf(item);
    for (let a = 0; a < sides.length; a += 1) {
      for (let b = a + 1; b < sides.length; b += 1) {
        for (const x of sides[a]) {
          for (const y of sides[b]) noteThread(state, x, y, 'match', at);
        }
      }
    }
  }

  // And if a belt was on the line, it may have just changed hands. Settled
  // after the match is written down, so the journal reads in the order the
  // night actually happened.
  if (item.titleId && result.winnerIds) {
    const title = titleById(state, item.titleId);
    if (title) settleTitleMatch(state, title, result.winnerIds, at);
  }

  // Anything the GM could hear from the next room and never went to look at has
  // run out of time. The night moved on without them.
  closeAlerts(state, at);

  // The bell rings, and the two of them are still standing there. Most of what
  // can happen next is colour and settles itself; the ones where somebody gets
  // hurt come back here to be handed over.
  //
  // All of it went out on television, so wherever the GM was standing they
  // know — the one kind of incident presence cannot make you miss.
  result.at = at;
  const moment = resolvePostMatch(state, item, result, state.show.items.indexOf(item), roll);
  if (moment && moment.incident) {
    moment.incident.at = at;
    raise(state, moment.incident);
  }

  // The building rearranges between segments, and the next gap is however long
  // the next thing on the card runs.
  shuffleRooms(state, roll);
  openTheGap(state);

  // Anything put off comes back first, and comes back bigger.
  if (!state.pendingIncident && (state.deferred || []).length) {
    const back = state.deferred.shift();
    back.at = at;
    represent(state, back);
  }

  if (state.pendingIncident) return result; // the show holds until the GM answers
  finishIfDone(state, at);
  return result;
}

// ---------------------------------------------------------------- presence

// An incident happens. Whether the GM finds out — and whether they get to rule
// on it — is a question about where they were standing, and nothing else.
function raise(state, incident) {
  const { severity } = resolveIncident(state, incident);
  const reach = incident.onCamera
    ? 'witnessed'
    : visibility(state, incident.locationId, carryOf(incident.kind));
  const full = { ...incident, severity, reach };

  if (reach === 'witnessed') {
    state.pendingIncident = full;
  } else if (reach === 'heard') {
    state.alerts = state.alerts || [];
    state.alerts.push(full);
  } else {
    missIt(state, full);
  }
  return full;
}

// Something already resolved, put in front of the GM again. It does not happen
// twice — it is the same situation, still waiting, and where the GM is standing
// now decides whether they see it this time either.
function represent(state, incident) {
  const locationId = incident.victimId === 'gm' ? state.location : incident.locationId;
  const reach = visibility(state, locationId, carryOf(incident.kind));
  const full = { ...incident, locationId, reach };

  if (reach === 'witnessed') state.pendingIncident = full;
  else if (reach === 'heard') (state.alerts = state.alerts || []).push(full);
  else missIt(state, full);
  return full;
}

// Nobody ruled on it. It still happened, everybody in it still remembers it,
// and the fact that no answer came is its own answer.
function missIt(state, incident) {
  state.missed = state.missed || [];
  state.missed.push(incident);
  state.gmRecord.missed = (state.gmRecord.missed || 0) + 1;

  state.journal.push(createEntry({
    week: state.week, at: incident.at || 0, type: 'missed',
    data: {
      kind: incident.kind,
      aggressorId: incident.aggressorId,
      victimId: incident.victimId,
      locationId: incident.locationId,
      // Where you were instead. The aftermath is a great deal more useful when
      // it can say that.
      whereYouWere: state.location,
    },
  }));

  // Somebody who came looking for you and did not find you takes that
  // personally, and they are right to.
  if (incident.victimId === 'gm') {
    remember(state, incident.aggressorId, {
      source: 'gm', weight: -5, detail: 'not-there',
    });
  }

  if (incident.kind === 'walkout') walkOut(state, incident);
  if (incident.kind === 'refusal') pullRefused(state, incident);
}

// Nobody got to the car park in time.
const WALKOUT_WEEKS = 3;
function walkOut(state, incident) {
  const wrestler = byId(state.wrestlers, incident.aggressorId);
  if (!wrestler) return;
  wrestler.status = 'Unavailable';
  wrestler.suspendedUntil = state.week + WALKOUT_WEEKS;
  delete (state.whereabouts || {})[wrestler.id];
  if (!wrestler.grudges.some(g => g.type === 'walked-out')) {
    wrestler.grudges.push({
      id: nextId('gr'), week: state.week, type: 'walked-out', targetId: null, data: {},
    });
  }
  state.journal.push(createEntry({
    week: state.week, at: incident.at || 0, type: 'walked-out',
    data: { wrestlerId: wrestler.id, weeks: WALKOUT_WEEKS },
  }));
}

// They would not go out and nobody was there to make them. The segment comes
// off the card, which is minutes of nothing and a hole in the rundown.
function pullRefused(state, incident) {
  const aired = new Set(state.broadcast.results.map(r => r.itemId));
  const item = state.show.items.find(i => i.id === incident.itemId && !aired.has(i.id));
  if (!item) return;
  state.show.items = state.show.items.filter(i => i !== item);
  state.journal.push(createEntry({
    week: state.week, at: incident.at || 0, type: 'pulled-item',
    data: { wrestlerId: incident.aggressorId, participants: [...item.participants] },
  }));
  openTheGap(state);
}

// Alerts expire when the segment does. You had the length of a match to go and
// look, and you spent it on something else.
function closeAlerts(state, at) {
  for (const alert of state.alerts || []) missIt(state, { ...alert, at });
  state.alerts = [];
}

// ---------------------------------------------------------------- what you do

// Crossing the building. The walk is the cost, and the night does not wait
// while you are in the corridor.
export function walkTo(state, locationId) {
  if (state.phase !== PHASES.LIVE || state.pendingIncident) return null;
  if (locationId === state.location) return null;

  const minutes = walkMinutes(state.location, locationId);
  if (!canSpend(state, minutes)) return null;

  // Arrive first, then let the walk's worth of night land — so anything that
  // happens on the way is judged against where they were going, not where they
  // set off from.
  state.location = locationId;
  advanceClock(state, minutes);
  state.journal.push(createEntry({
    week: state.week, at: nowAt(state), type: 'moved', data: { locationId },
  }));
  return locationId;
}

// Going to look at whatever you could hear through the wall. You get to rule on
// it, but you are arriving after the room has already made up its mind, and a
// ruling that arrives late is worth less than one that arrives.
export function goAndLook(state, alertId) {
  if (state.phase !== PHASES.LIVE || state.pendingIncident) return null;
  const alert = (state.alerts || []).find(a => a.id === alertId);
  if (!alert) return null;

  const minutes = walkMinutes(state.location, alert.locationId);
  if (!canSpend(state, minutes)) return null;

  state.location = alert.locationId;
  state.alerts = state.alerts.filter(a => a !== alert);
  spend(state, minutes); // the walk itself; the situation is already waiting
  state.pendingIncident = { ...alert, reach: 'witnessed', late: true };
  return state.pendingIncident;
}

// Finding somebody and hearing them out. Costs a couple of minutes, and buys
// two things: they remember that you came looking, and you learn them faster
// than you would by booking them. Once each per night — the second conversation
// in an evening is not a conversation.
export function talkTo(state, wrestlerId) {
  if (state.phase !== PHASES.LIVE || state.pendingIncident) return null;
  if (roomOf(state, wrestlerId) !== state.location) return null;

  state.spokenTo = state.spokenTo || [];
  if (state.spokenTo.includes(wrestlerId)) return null;
  if (!canSpend(state, TALK_MINUTES)) return null;

  const wrestler = byId(state.wrestlers, wrestlerId);
  if (!wrestler) return null;

  state.spokenTo.push(wrestlerId);
  growFamiliarity(wrestler, true);
  remember(state, wrestler, { source: 'gm', weight: 3, detail: 'sought-them-out' });
  state.journal.push(createEntry({
    week: state.week, at: nowAt(state), type: 'talked', data: { wrestlerId },
  }));
  advanceClock(state, TALK_MINUTES);
  return wrestler;
}

// Which answers are on the table right now. Almost everything is always
// offered, including every bad idea — the three exclusions would be nonsense
// rather than merely unwise, and security is a pair of people rather than a
// button.
export function availableResponses(state) {
  const incident = state.pendingIncident;
  if (!incident) return [];
  const room = remainingMinutes(state.show, state.broadcast);
  const twoSided = hasTwoSides(incident);

  return RESPONSES.filter(response => {
    if (response.needsRuntime && room < 10) return false;
    if (response.needsTwo && !twoSided) return false;
    if (response.needsDemand && !incident.demand) return false;
    if (response.id === 'security' && securityLeft(state) <= 0) return false;
    return true;
  });
}

// Putting something off does not make it smaller. It comes back after the next
// segment, one step heavier, and wherever you are standing then.
const WORSE = { minor: 'moderate', moderate: 'major', major: 'critical', critical: 'critical' };

export function resolveIncidentResponse(state, responseId) {
  const incident = state.pendingIncident;
  if (!incident) return null;

  const outcome = applyResponse(state, incident, responseId);
  if (!outcome) return null;

  const twoSided = hasTwoSides(incident);
  const reason = incidentKind(incident.kind || 'attack').note;

  if (responseId === 'delay') {
    state.deferred = state.deferred || [];
    state.deferred.push({
      ...incident,
      severity: WORSE[incident.severity] || 'moderate',
      deferrals: (incident.deferrals || 0) + 1,
      late: false,
    });
  } else if (responseId === 'giveIn') {
    concede(state, incident);
  } else if (responseId === 'bookTonight' && twoSided) {
    outcome.booked = bookIncidentMatch(state, incident);
  } else if (responseId === 'bookNext' && twoSided) {
    outcome.opportunity = createOpportunity(state, {
      aggressorId: incident.aggressorId,
      victimId: incident.victimId,
      reason,
      promised: true,
    });
  } else if (twoSided && !outcome.suspended && outcome.mediationWorked !== true) {
    // Anything left unresolved is still sitting there to be used.
    outcome.opportunity = createOpportunity(state, {
      aggressorId: incident.aggressorId,
      victimId: incident.victimId,
      reason,
    });
  }

  state.pendingIncident = null;
  finishIfDone(state, incident.at || 0);
  return outcome;
}

// Handing over what was asked for. Each demand has a shape, and giving in means
// the shape happens — a promise you now have to keep, a spot somebody else no
// longer has, or a wrestler you will not see for a while.
const LEAVE_WEEKS = 8;
function concede(state, incident) {
  const wrestler = byId(state.wrestlers, incident.aggressorId);
  if (!wrestler) return;

  if (incident.demand === 'out') {
    wrestler.status = 'Unavailable';
    wrestler.suspendedUntil = state.week + LEAVE_WEEKS;
    delete (state.whereabouts || {})[wrestler.id];
    state.journal.push(createEntry({
      week: state.week, at: incident.at || 0, type: 'granted-leave',
      data: { wrestlerId: wrestler.id, weeks: LEAVE_WEEKS },
    }));
    return;
  }

  if (incident.demand === 'spot' && incident.itemId) {
    // Moved down the card means moved later, past whatever was after it.
    const index = state.show.items.findIndex(i => i.id === incident.itemId);
    if (index >= 0 && index < state.show.items.length - 1) {
      const [item] = state.show.items.splice(index, 1);
      state.show.items.push(item);
    }
  }

  if (incident.demand === 'airtime' || incident.demand === 'match' || incident.demand === 'title') {
    // A promise with a name on it. Unkept, it is worse than never offered.
    const other = hasTwoSides(incident) ? incident.victimId : pickOpponent(state, wrestler);
    if (other) {
      createOpportunity(state, {
        aggressorId: wrestler.id,
        victimId: other,
        reason: DEMANDS[incident.demand] ? DEMANDS[incident.demand].label : 'what they asked for',
        promised: true,
      });
    }
  }
}

// Whoever they would most want across the ring, for a promise that needs an
// opponent attached to it.
function pickOpponent(state, wrestler) {
  const grudge = (wrestler.grudges || []).find(g => g.targetId);
  if (grudge) return grudge.targetId;
  const ranked = Object.entries(wrestler.relationships || {})
    .filter(([id]) => {
      const other = byId(state.wrestlers, id);
      return other && other.status === 'Available';
    })
    .sort((a, b) => b[1].matches - a[1].matches);
  return ranked.length ? ranked[0][0] : null;
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
  // The building empties. Whatever you could still hear is now something that
  // happened and nobody answered.
  closeAlerts(state, at);
  // Who laid eyes on you tonight, before the building empties and the answer
  // stops being knowable.
  noteWhoSawYou(state);
  settlePresence(state);
  state.clock = null;
  state.journal.push(createEntry({ week: state.week, at, type: 'show-end' }));
  // The locker room reacts once, when the show comes off the air.
  settleShow(state);
  // Anything announced for tonight that did not happen is counted before the
  // executives grade it, because it is the first thing they will mention.
  checkBreaches(state);

  // And then the people upstairs decide whether you have earned more of their
  // airtime. Graded once and stored, so the post-show reads the same number it
  // actually awarded. A special event counts double, in both directions.
  const review = reviewShow(state);
  const award = awardTrust(state, review.grade, isPpvWeek(state.week) ? 2 : 1);
  state.lastReview = { ...review, ...award };

  // And what the night was worth to the GM personally, which is a different
  // question from what it was worth to the network. Read off the journal so
  // there is one source of truth for it.
  const earned = xpForShow(state, review);
  awardXp(state, earned.total, earned.lines);
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

  // Keep the week before replacing it. This is the only place history is made.
  archiveWeek(state);

  state.week += 1;
  // The network pays for the minutes it gave you and the roster is paid
  // whether or not you used them. One line a week, and the only reason the
  // budget on the setup screen means anything.
  settleWeek(state);
  releaseSuspensions(state);
  healInjuries(state);
  // Last week stops being the whole of what somebody thinks about. How much it
  // stops being is a question about the person, not about the week.
  fadeMemories(state);
  coolGrudges(state);
  ageOpportunities(state);
  championMorale(state);
  forgetColdThreads(state);

  // And then the locker room rearranges itself. People who keep turning up for
  // each other become a unit, and people who cannot stand the same third person
  // find they have something in common. Nobody booked any of it.
  for (const tie of formTies(state)) {
    state.journal.push(createEntry({
      week: state.week, at: 0, type: 'tie-formed', data: tie,
    }));
  }

  state.breaches = 0;

  state.show = createShow({
    name: showNameFor(state, state.week),
    runtimeMinutes: runtimeForWeek(state, state.week),
  });
  // Whatever was planned for this week is already on the card.
  loadScheduled(state);

  state.broadcast = null;
  state.phase = PHASES.PREP;

  // The building is empty until the next show goes on the air.
  state.location = START_LOCATION;
  state.whereabouts = {};
  state.clock = null;
  state.alerts = [];
  state.missed = [];
  state.deferred = [];
  state.spokenTo = [];
  state.sawYou = [];
  resetSecurity(state);
  return true;
}
