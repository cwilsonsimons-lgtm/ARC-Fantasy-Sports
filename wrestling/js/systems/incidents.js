// Things going wrong, and what the GM does about them.
//
// The tier the whole stack has been building toward. Tier 4 worked out how
// people take a booking, Tier 5 gave them opinions of each other, Tier 6 gave
// them a voice, Tier 7 put them in rooms and made news travel. This is where
// that turns into something the GM has to handle on the night.
//
// Three rules:
//
//   1. **An incident needs a cause.** Nothing here rolls a die and invents a
//      problem. Pressure is computed from hostility, personality, morale,
//      memories and the card, and the roll only decides whether pressure that
//      is already there tips over. Every incident carries its reasons.
//   2. **You can only answer what you know about.** Incidents are raised
//      wherever they happen. Tier 7 decides whether the GM ever hears, and how
//      late. An incident that never reaches them costs them nothing, which is
//      what makes being wired in worth anything.
//   3. **Every answer costs something.** There is no free option. Talking
//      costs show clock and can fail; security always works and is remembered
//      as being handled; ignoring is a choice the room notices.
//
// Escalation over time is NOT here. The design foundation has it, and it is a
// timer on top of this; `EVENT_TYPES.INCIDENT_ESCALATED` stays reserved.

import * as store from '../core/store.js';
import { EVENT_TYPES, VISIBILITY } from '../core/events.js';
import {
  INCIDENT_KINDS, INCIDENT_SPECS, INCIDENT_STATUS, RESPONSES, RESPONSE_SPECS,
  responseSpec, severityLabel, isAnswerable, SUSPENSION_DAYS,
} from '../models/incident.js';
import { MEMORY_TYPES, memorySpec } from '../models/memory.js';
import { SEGMENT_STATUS, SEGMENT_KINDS, FINISHES } from '../models/segment.js';
import { SHOW_STATUS } from '../models/show.js';
import {
  relationshipWith, memoryWeightOn, standingWeight, statusRank, alliesOf,
} from '../models/wrestler.js';
import { RESPONSE, responseFor, regardSegment } from './disposition.js';
import { satisfactionOf, DIMENSION_LABEL } from './satisfaction.js';
import { locationName } from '../models/location.js';
import { RELIABILITY } from '../models/notification.js';
import { REQUEST_STATUS, REQUEST_NOUN } from '../models/request.js';

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/** At or above this, pressure is worth rolling against at all. */
export const PRESSURE_FLOOR = 22;

/**
 * How much of the pressure actually tips over.
 *
 * The design asks for "almost every show has some chaos, and most of it is
 * small", and the floor is friction rather than crisis. These are tuned against
 * `tools/wgm-incident-check.mjs`, which measures the real distribution over
 * forty simulated shows rather than trusting the numbers to be right: roughly
 * two or three things a night, four in five of them a row or a grumble.
 *
 * Each of these is rolled once per segment, so a five-match card gets six
 * chances at each and the per-roll number is much smaller than the per-night
 * one.
 */
export const FRICTION_RATE = 0.14;
export const CONFRONTATION_RATE = 0.18;
export const COMPLAINT_RATE = 0.11;
export const MEETING_RATE = 0.10;

/** How many incidents one night can raise, so a bad week is not an avalanche. */
export const MAX_PER_SHOW = 4;

/**
 * Below this, leaving something alone costs the GM nothing.
 *
 * A GM who does not personally mediate every grumble in catering is not a bad
 * GM, and charging them for it grinds their standing down to nothing over a
 * couple of months. What the roster actually holds against you is the serious
 * thing you knew about and walked past.
 */
export const LAPSE_MATTERS_ABOVE = 54;

// ---------------------------------------------------------------------------
// Pressure: why something would go wrong
// ---------------------------------------------------------------------------

/**
 * How close two people in a room are to having words.
 *
 * Hostility is the bulk of it, as it should be, but a volatile person with a
 * fresh grudge and no patience gets there from less. Respect works the other
 * way: two people who rate each other keep a lid on it.
 */
export function frictionBetween(aId, bId) {
  const a = store.getWrestler(aId);
  const b = store.getWrestler(bId);
  if (!a || !b) return { score: 0, reasons: [] };

  const today = store.today();
  const ab = relationshipWith(a, bId);
  const ba = relationshipWith(b, aId);
  const heat = Math.max(ab.hostility, ba.hostility);
  const reasons = [];
  let score = 0;

  if (heat > 0) {
    const add = heat * 0.75;
    score += add;
    if (heat >= 30) {
      reasons.push({
        label: 'Bad blood',
        detail: `${heat} heat between them`,
        weight: Math.round(add),
      });
    }
  }

  const ta = a.identity.traits;
  const tb = b.identity.traits;
  const volatility = Math.max(ta.volatility, tb.volatility);
  const aggression = Math.max(ta.aggression, tb.aggression);
  const patience = Math.min(ta.patience, tb.patience);

  const temper = volatility * 0.18 + aggression * 0.12 - patience * 0.14;
  score += temper;
  if (temper > 8) {
    const hot = ta.volatility >= tb.volatility ? a : b;
    reasons.push({
      label: 'Short fuse',
      detail: `${hot.name} does not let things go`,
      weight: Math.round(temper),
    });
  }

  // A fresh grudge is sharper than an old one. memoryWeightOn already decays.
  for (const [self, otherId, other] of [[a, bId, b], [b, aId, a]]) {
    const grudge = self.memory
      .filter((m) => m.aboutIds?.includes(otherId))
      .map((m) => ({ m, weight: memoryWeightOn(m, today) }))
      .sort((x, y) => y.weight - x.weight)[0];
    if (grudge && grudge.weight >= 30) {
      const add = grudge.weight * 0.2;
      score += add;
      reasons.push({
        label: 'Unfinished business',
        detail: `${self.name} has not forgotten: ${grudge.m.summary}`,
        weight: Math.round(add),
      });
    }
  }

  // Two people who rate each other do not do this in a corridor.
  const respect = Math.min(ab.respect, ba.respect);
  if (respect >= 55) {
    const off = (respect - 55) * 0.3;
    score -= off;
    reasons.push({
      label: 'Mutual respect',
      detail: 'Both of them know better',
      weight: -Math.round(off),
    });
  }

  // Misery looks for somewhere to go.
  const morale = Math.min(a.state.morale, b.state.morale);
  if (morale < 45) {
    const add = (45 - morale) * 0.22;
    score += add;
    const glum = a.state.morale <= b.state.morale ? a : b;
    reasons.push({
      label: 'Unhappy',
      detail: `${glum.name}'s morale is ${glum.state.morale}`,
      weight: Math.round(add),
    });
  }

  // A formal warning is supposed to do something. This is what it does.
  const warnings = a.state.discipline.warnings + b.state.discipline.warnings;
  if (warnings) {
    const off = Math.min(18, warnings * 9);
    score -= off;
    reasons.push({
      label: 'On a warning',
      detail: `${warnings} formal warning${warnings === 1 ? '' : 's'} between them`,
      weight: -off,
    });
  }

  return { score: clamp(score), reasons: reasons.sort((x, y) => Math.abs(y.weight) - Math.abs(x.weight)) };
}

/** How much somebody has to say to the GM about how they are being used. */
export function grievancePressure(wrestlerId) {
  const w = store.requireWrestler(wrestlerId);
  const sat = satisfactionOf(wrestlerId);
  const reasons = [];

  // The worst thing about their situation, in their own words.
  const worstLabel = DIMENSION_LABEL[sat.worst.key] || sat.worst.key;
  let score = Math.max(0, 55 - sat.worst.score) * 0.9;
  if (score > 0) {
    const said = sat.worst.reasons?.[0];
    reasons.push({
      label: worstLabel,
      detail: (typeof said === 'string' ? said : said?.detail || said?.text) || 'Not happy with it',
      weight: Math.round(score),
    });
  }

  // Ego decides whether a grievance is something you mention.
  const nerve = w.identity.ego * 0.22 + (100 - w.identity.traits.professionalism) * 0.1;
  score += nerve;
  if (w.identity.ego >= 60) {
    reasons.push({ label: 'Ego', detail: `Thinks they are worth more`, weight: Math.round(nerve) });
  }

  if (w.state.morale < 40) {
    const add = (40 - w.state.morale) * 0.3;
    score += add;
    reasons.push({ label: 'Morale', detail: `Morale is ${w.state.morale}`, weight: Math.round(add) });
  }

  // Somebody who does not believe a word you say does not bother complaining.
  if (w.ties.gm.trust < 30) {
    const off = (30 - w.ties.gm.trust) * 0.5;
    score -= off;
    reasons.push({
      label: 'Past caring',
      detail: `Trusts you ${w.ties.gm.trust}, so why bother`,
      weight: -Math.round(off),
    });
  }

  return { score: clamp(score), reasons, satisfaction: sat, worstLabel };
}

/** Somebody who wants a word rather than a row. */
export function meetingPressure(wrestlerId) {
  const w = store.requireWrestler(wrestlerId);
  const today = store.today();
  const reasons = [];
  let score = 0;

  // Being ignored is what makes somebody come and find you.
  const ignored = w.memory
    .filter((m) => m.type === MEMORY_TYPES.REQUEST_IGNORED.key)
    .map((m) => memoryWeightOn(m, today));
  if (ignored.length) {
    const add = Math.min(45, ignored.reduce((t, x) => t + x, 0) * 0.35);
    score += add;
    reasons.push({
      label: 'Asked and heard nothing',
      detail: `${ignored.length} request${ignored.length === 1 ? '' : 's'} went unanswered`,
      weight: Math.round(add),
    });
  }

  const grievances = w.memory
    .filter((m) => [
      MEMORY_TYPES.CUT_FROM_SHOW.key, MEMORY_TYPES.OVERLOOKED.key,
      MEMORY_TYPES.TITLE_SHOT_DENIED.key, MEMORY_TYPES.LEFT_TO_IT.key,
    ].includes(m.type))
    .map((m) => ({ m, weight: memoryWeightOn(m, today) }))
    .sort((a, b) => b.weight - a.weight);
  if (grievances.length) {
    const add = Math.min(35, grievances[0].weight * 0.5);
    score += add;
    reasons.push({ label: 'Something on their mind', detail: grievances[0].m.summary, weight: Math.round(add) });
  }

  // An open ask is a reason to come and press it in person.
  const open = store.openRequestsFor(wrestlerId);
  if (open.length) {
    const add = Math.min(28, open[0].urgency * 0.3);
    score += add;
    reasons.push({
      label: 'Waiting on an answer',
      detail: `Still wants ${REQUEST_NOUN[open[0].kind] || 'an answer'}`,
      weight: Math.round(add),
    });
  }

  // You have to be willing to knock on the door.
  const nerve = w.ties.gm.trust * 0.2 + standingWeight(w) * 22 + w.identity.traits.sociability * 0.12;
  score += nerve - 22;

  return { score: clamp(score), reasons };
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

function liveShow() {
  return store.allShows().find((s) => s.status === SHOW_STATUS.LIVE) || null;
}

function raisedTonight(showId) {
  return store.allIncidents().filter((i) => i.showId === showId).length;
}

/** Everybody sharing a room, as unordered pairs. Nothing happens alone. */
function pairsInRooms() {
  const out = [];
  const seen = new Set();
  for (const w of store.allWrestlers()) {
    const room = store.locationOf(w.id);
    for (const other of store.whoIsIn(room)) {
      if (other.id === w.id) continue;
      const key = [w.id, other.id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ a: w, b: other, room });
    }
  }
  return out;
}

/**
 * Look around the building for two people about to have words.
 *
 * Only the hottest pair in the building is considered per call, because a show
 * where four rows break out at once is a farce rather than a wrestling
 * programme.
 */
export function checkFriction({ cause = null } = {}) {
  const show = liveShow();
  if (!show || raisedTonight(show.id) >= MAX_PER_SHOW) return null;
  const rng = store.getRng();

  const candidates = pairsInRooms()
    .map(({ a, b, room }) => ({ a, b, room, ...frictionBetween(a.id, b.id) }))
    .filter((c) => c.score >= PRESSURE_FLOOR)
    // Somebody already in something tonight is not also starting the next one.
    .filter((c) => !busyWith(c.a.id) && !busyWith(c.b.id))
    .sort((x, y) => y.score - x.score);
  if (!candidates.length) return null;

  const top = candidates[0];
  if (!rng.chance((top.score / 100) * FRICTION_RATE)) return null;

  // The same pressure produces a row or a fight. Where it lands is decided by
  // how hot it was and how much fight is in the two of them.
  const violence = Math.max(top.a.identity.traits.aggression, top.b.identity.traits.aggression);
  const goesPhysical = top.score >= 62 && rng.chance((top.score - 62) / 180 + violence / 450);
  const kind = goesPhysical ? INCIDENT_KINDS.FIGHT : INCIDENT_KINDS.ARGUMENT;

  // A row grows slowly with the pressure behind it; a fight grows fast, which
  // is what makes a crisis something that happens rather than a band nothing
  // ever reaches.
  const growth = goesPhysical ? 0.45 : 0.22;
  const severity = INCIDENT_SPECS[kind].baseSeverity + (top.score - PRESSURE_FLOOR) * growth;
  const incident = store.raiseIncident({
    kind,
    locationId: top.room,
    showId: show.id,
    participantIds: [top.a.id, top.b.id],
    instigatorId: top.a.identity.traits.aggression >= top.b.identity.traits.aggression ? top.a.id : top.b.id,
    targetId: top.b.id,
    severity,
    reasons: top.reasons,
    summary: goesPhysical
      ? `${top.a.name} and ${top.b.name} come to blows in ${locationName(top.room)}`
      : `${top.a.name} and ${top.b.name} are shouting at each other in ${locationName(top.room)}`,
    newsSummary: goesPhysical
      ? `${top.a.name} and ${top.b.name} have had a fight in ${locationName(top.room)}`
      : `${top.a.name} and ${top.b.name} are having a row in ${locationName(top.room)}`,
  }, { cause });

  // The row itself costs something, before the GM does anything about it.
  const bite = goesPhysical ? 9 : 5;
  store.adjustRelationship(top.a.id, top.b.id, { hostility: bite, trust: -bite },
    { reason: `Row in ${locationName(top.room)}`, cause: incident.causeEventId });
  store.adjustRelationship(top.b.id, top.a.id, { hostility: bite, trust: -bite },
    { reason: `Row in ${locationName(top.room)}`, cause: incident.causeEventId });

  return incident;
}

/** Already in something open tonight. */
function busyWith(wrestlerId) {
  return store.openIncidents().some((i) => i.participantIds.includes(wrestlerId));
}

/**
 * Coming back through the curtain.
 *
 * A loser with heat and a reason goes after the winner where everyone can see
 * it. This is the one incident type with a segment attached, so the cause is
 * never in doubt: the match that just happened is right there in the log.
 */
export function checkConfrontation(segment, result, { cause = null } = {}) {
  const show = liveShow();
  if (!show || segment.kind !== SEGMENT_KINDS.MATCH) return null;
  if (raisedTonight(show.id) >= MAX_PER_SHOW) return null;
  const rng = store.getRng();

  const winners = new Set(result.winnerIds || []);
  const losers = segment.participants
    .map((p) => p.wrestlerId)
    .filter((id) => !winners.has(id));
  if (!losers.length || !winners.size) return null;

  const pairs = [];
  for (const loserId of losers) {
    for (const winnerId of winners) {
      const pressure = frictionBetween(loserId, winnerId);
      const loser = store.getWrestler(loserId);
      const reasons = [...pressure.reasons];
      let score = pressure.score;

      // Losing to somebody beneath you in front of everybody is its own thing.
      const gap = statusRank(loser) - statusRank(store.getWrestler(winnerId));
      if (gap > 0) {
        const add = gap * 9;
        score += add;
        reasons.push({
          label: 'Beaten by somebody beneath them',
          detail: `${gap} rung${gap === 1 ? '' : 's'} down the card`,
          weight: add,
        });
      }
      if (result.finish === FINISHES.DQ) {
        score += 20;
        reasons.push({ label: 'It ended in a disqualification', detail: 'Nothing was settled', weight: 20 });
      }
      pairs.push({ loserId, winnerId, score: clamp(score), reasons });
    }
  }

  const top = pairs.sort((a, b) => b.score - a.score)[0];
  if (top.score < PRESSURE_FLOOR) return null;
  if (!rng.chance((top.score / 100) * CONFRONTATION_RATE)) return null;

  const loser = store.getWrestler(top.loserId);
  const winner = store.getWrestler(top.winnerId);
  const severity = INCIDENT_SPECS[INCIDENT_KINDS.CONFRONTATION].baseSeverity
    + (top.score - PRESSURE_FLOOR) * 0.2;

  return store.raiseIncident({
    kind: INCIDENT_KINDS.CONFRONTATION,
    locationId: store.locationOf(top.loserId),
    showId: show.id,
    segmentId: segment.id,
    participantIds: [top.loserId, top.winnerId],
    instigatorId: top.loserId,
    targetId: top.winnerId,
    severity,
    reasons: top.reasons,
    summary: `${loser.name} goes after ${winner.name} coming back from ${segment.name}`,
    newsSummary: `${loser.name} went after ${winner.name} on the way back from the ring`,
  }, { cause });
}

/**
 * Somebody will not go out.
 *
 * This is Tier 4 finally doing something. `regard()` has been computing how
 * people take a booking since then and nothing acted on it; here a REFUSE
 * refuses, and a PUSH_BACK refuses only if they are volatile enough to make a
 * scene. The standing floor means a rookie essentially never gets here.
 */
export function checkRefusal(segment, { cause = null } = {}) {
  const show = liveShow();
  if (!show || segment.status !== SEGMENT_STATUS.BOOKED) return null;
  if (segment.blockedByIncidentId) return null;
  const rng = store.getRng();

  const all = store.segmentsOfShow(show.id);
  const regards = regardSegment(segment, {
    cardIndex: all.indexOf(segment),
    cardLength: all.length,
  });
  const worst = regards.sort((a, b) => a.willingness - b.willingness)[0];
  if (!worst) return null;

  const verdict = responseFor(worst.willingness);
  if (verdict !== RESPONSE.REFUSE && verdict !== RESPONSE.PUSH_BACK) return null;

  const w = store.requireWrestler(worst.wrestlerId);
  // Pushing back is not refusing. Only somebody volatile enough to make a scene
  // turns one into the other, and even an outright refusal is not certain: most
  // nights they grumble and go out anyway.
  if (verdict === RESPONSE.PUSH_BACK
    && !rng.chance(w.identity.traits.volatility / 900)) return null;
  if (verdict === RESPONSE.REFUSE && !rng.chance(0.3)) return null;

  const severity = INCIDENT_SPECS[INCIDENT_KINDS.REFUSAL].baseSeverity
    + (52 - worst.willingness) * 0.35;

  const incident = store.raiseIncident({
    kind: INCIDENT_KINDS.REFUSAL,
    locationId: store.locationOf(w.id),
    showId: show.id,
    segmentId: segment.id,
    blocksSegmentId: segment.id,
    participantIds: [w.id],
    instigatorId: w.id,
    severity,
    // `regard()` speaks in pulls on willingness; an incident speaks in pushes
    // toward trouble. Same facts, opposite sign, so they are translated here
    // rather than leaving two reason vocabularies loose in the save.
    reasons: (worst.reasons || [])
      .filter((r) => r.delta < 0)
      .sort((a, b) => a.delta - b.delta)
      .slice(0, 4)
      .map((r) => ({ label: r.text, detail: '', weight: Math.round(-r.delta) })),
    summary: `${w.name} will not go out for ${segment.name}`,
    newsSummary: `${w.name} is refusing to go out for ${segment.name}`,
    // Public, so Tier 7 does not treat it as something somebody has to come and
    // mention. A GM whose next match simply never starts knows at once that
    // something is wrong, wherever in the building they happen to be standing.
    visibility: VISIBILITY.PUBLIC,
  }, { cause });

  store.blockSegment(segment.id, incident.id);

  // The card stopping IS the notification. Without this the show can deadlock:
  // the segment will not run, and there is nobody the news has to travel
  // through, so the GM would be left with no way to find out or move on.
  store.scheduleNotification({
    eventId: incident.causeEventId,
    locationId: incident.locationId,
    aboutIds: [w.id],
    reliability: RELIABILITY.WITNESSED,
    sourceWrestlerId: null,
    dueTick: store.tick(),
    summary: `${segment.name} is not starting. ${w.name} will not go out.`,
    detail: `The card has stopped in ${locationName(incident.locationId)}.`,
  });
  store.deliverDueNotifications({ cause: incident.causeEventId });
  store.discoverIncident(incident.id);
  store.emit(EVENT_TYPES.BOOKING_REFUSED, {
    summary: `${w.name} refuses ${segment.name}`,
    actorId: w.id,
    subjects: [w.id],
    showId: show.id,
    segmentId: segment.id,
    locationId: incident.locationId,
    visibility: VISIBILITY.BACKSTAGE,
    cause: incident.causeEventId,
    data: {
      incidentId: incident.id,
      willingness: worst.willingness,
      floor: worst.floor,
      heldUpByStanding: worst.heldUpByStanding,
      reasons: worst.reasons,
    },
  });
  return incident;
}

/** Somebody with something to say about how they are being used. */
export function checkComplaints({ cause = null } = {}) {
  const show = liveShow();
  if (!show || raisedTonight(show.id) >= MAX_PER_SHOW) return null;
  const rng = store.getRng();

  const candidates = store.allWrestlers()
    .filter((w) => !busyWith(w.id))
    .map((w) => ({ w, ...grievancePressure(w.id) }))
    .filter((c) => c.score >= PRESSURE_FLOOR)
    .sort((a, b) => b.score - a.score);
  if (!candidates.length) return null;

  const top = candidates[0];
  if (!rng.chance((top.score / 100) * COMPLAINT_RATE)) return null;

  const severity = INCIDENT_SPECS[INCIDENT_KINDS.COMPLAINT].baseSeverity
    + (top.score - PRESSURE_FLOOR) * 0.25;

  return store.raiseIncident({
    kind: INCIDENT_KINDS.COMPLAINT,
    locationId: store.locationOf(top.w.id),
    showId: show.id,
    participantIds: [top.w.id],
    severity,
    reasons: top.reasons,
    summary: `${top.w.name} is complaining about ${top.worstLabel.toLowerCase()}`,
    newsSummary: `${top.w.name} is going round complaining about ${top.worstLabel.toLowerCase()}`,
  }, { cause });
}

/** Somebody who wants five minutes of your time. */
export function checkMeetingRequests({ cause = null } = {}) {
  const show = liveShow();
  if (!show || raisedTonight(show.id) >= MAX_PER_SHOW) return null;
  const rng = store.getRng();

  const candidates = store.allWrestlers()
    .filter((w) => !busyWith(w.id))
    .map((w) => ({ w, ...meetingPressure(w.id) }))
    .filter((c) => c.score >= PRESSURE_FLOOR && c.reasons.length)
    .sort((a, b) => b.score - a.score);
  if (!candidates.length) return null;

  const top = candidates[0];
  if (!rng.chance((top.score / 100) * MEETING_RATE)) return null;

  return store.raiseIncident({
    kind: INCIDENT_KINDS.MEETING_REQUEST,
    locationId: store.locationOf(top.w.id),
    showId: show.id,
    participantIds: [top.w.id],
    severity: INCIDENT_SPECS[INCIDENT_KINDS.MEETING_REQUEST].baseSeverity
      + (top.score - PRESSURE_FLOOR) * 0.2,
    reasons: top.reasons,
    summary: `${top.w.name} is asking for a word`,
    newsSummary: `${top.w.name} is looking for you`,
  }, { cause });
}

// ---------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------

/**
 * Whether the GM can use a given answer on a given incident, and why not.
 *
 * `needsPresence` is where Tier 7 becomes a cost rather than a screen: talking
 * to somebody means being in the room with them, and walking there spends the
 * night's clock while the show carries on without you.
 */
export function canRespond(incident, key) {
  const spec = responseSpec(key);
  const problems = [];

  if (!isAnswerable(incident)) problems.push('You do not know about this');
  if (incident.attempted.includes(key)) problems.push('You have already tried that');
  if (incident.participantIds.length < spec.minParticipants) {
    problems.push(`${spec.label} needs ${spec.minParticipants} people`);
  }
  if (spec.betweenOnly && !INCIDENT_SPECS[incident.kind].between) {
    problems.push(`There is nobody to ${key === RESPONSES.BOOK_MATCH ? 'book them against' : 'separate them from'}`);
  }
  if (spec.needsPresence && store.gmLocation() !== incident.locationId) {
    problems.push(`You are not in ${locationName(incident.locationId)}`);
  }
  if (spec.liveShowOnly && !liveShow()) {
    problems.push('There is no show to send them home from');
  }
  if (key === RESPONSES.BOOK_MATCH && !showWithRoom()) {
    problems.push('No upcoming show to put it on');
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Where a match born out of trouble can actually go.
 *
 * Never tonight's card: the two of them have usually just wrestled, and the
 * booking rules would refuse them anyway. "You will get him, next week" is also
 * the better answer, because it gives the heat somewhere to sit.
 */
function showWithRoom() {
  return store.allShows()
    .find((s) => s.status === SHOW_STATUS.SCHEDULED) || null;
}

/**
 * How likely talking or mediating is to land.
 *
 * Built from whether they believe you, whether they are the sort to listen, and
 * how bad it is. A crisis between two volatile people who do not trust you is
 * not going to be talked down, and that is correct.
 */
export function chanceOf(incident, key) {
  const spec = responseSpec(key);
  if (spec.alwaysLands) return 1;

  const people = incident.participantIds.map((id) => store.requireWrestler(id));
  const avg = (fn) => people.reduce((t, w) => t + fn(w), 0) / people.length;

  const trust = avg((w) => w.ties.gm.trust);
  const respect = avg((w) => w.ties.gm.respect);
  const professionalism = avg((w) => w.identity.traits.professionalism);
  const volatility = avg((w) => w.identity.traits.volatility);

  // Trust is the biggest term on purpose. Talking somebody down is the payoff
  // for having been straight with them, and a GM nobody believes has to reach
  // for security instead - which is the trade the whole tier is built on.
  let chance = 0.24
    + trust * 0.0055
    + respect * 0.0022
    + professionalism * 0.0028
    - volatility * 0.0022
    - incident.severity * 0.0055;

  // Mediating is the harder of the two: you are asking two people to climb
  // down in front of each other.
  if (key === RESPONSES.MEDIATE) chance -= 0.12;

  return Math.max(0.05, Math.min(0.95, chance));
}

/** Everything the GM could do about this, with the working shown. */
export function optionsFor(incidentId) {
  const incident = store.requireIncident(incidentId);
  return Object.values(RESPONSE_SPECS).map((spec) => {
    const verdict = canRespond(incident, spec.key);
    return {
      ...spec,
      ok: verdict.ok,
      problems: verdict.problems,
      chance: chanceOf(incident, spec.key),
    };
  });
}

/** Note it against everyone in the incident. */
function rememberAll(incident, typeKey, summary, { cause = null, aboutGm = true } = {}) {
  for (const id of incident.participantIds) {
    store.addMemory(id, memorySpec(typeKey, {
      summary,
      aboutIds: aboutGm ? [] : incident.participantIds.filter((x) => x !== id),
      day: store.today(),
    }), { cause });
  }
}

/**
 * The GM answers.
 *
 * Every branch does the same three things in the same order: change the world,
 * write what the people in it will remember, and close the incident with the
 * effects recorded so the log can be read back afterwards.
 */
export function respond(incidentId, key, { reason = '' } = {}) {
  const incident = store.requireIncident(incidentId);
  const spec = responseSpec(key);
  const verdict = canRespond(incident, key);
  if (!verdict.ok) throw new Error(verdict.problems[0]);

  store.noteAttempt(incidentId, key);
  if (spec.seconds) store.advanceTick(spec.seconds);

  const cause = incident.causeEventId;
  const effects = [];
  const names = incident.participantIds.map(store.nameOf);
  const weight = incident.severity / 100;

  const gm = (id, deltas, why) => {
    store.adjustGmTie(id, deltas, { reason: why, cause });
    effects.push({ wrestlerId: id, ...deltas, why });
  };

  const landed = spec.alwaysLands ? true : store.getRng().chance(chanceOf(incident, key));
  let summary = reason;

  store.emit(EVENT_TYPES.GM_RESPONDED, {
    summary: `${spec.label}: ${names.join(' and ')}`,
    subjects: incident.participantIds,
    showId: incident.showId,
    locationId: incident.locationId,
    cause,
    data: { incidentId, response: key, severity: incident.severity, landed },
  });

  switch (key) {
    // --- do nothing, on purpose ------------------------------------------
    case RESPONSES.IGNORE: {
      for (const id of incident.participantIds) {
        gm(id, { respect: -Math.round(1 + weight * 13) }, 'Watched it happen and did nothing');
      }
      // A grumble left alone is forgotten. A serious thing left alone is not.
      if (incident.severity >= LAPSE_MATTERS_ABOVE) {
        rememberAll(incident, MEMORY_TYPES.LEFT_TO_IT.key,
          `The GM knew about ${INCIDENT_SPECS[incident.kind].noun} and left it`, { cause });
      }
      // Nothing was settled, so whatever was between them stays between them.
      if (incident.targetId) {
        store.adjustRelationship(incident.instigatorId, incident.targetId,
          { hostility: Math.round(3 + weight * 6) },
          { reason: 'Left to fester', cause });
      }
      summary = summary || `Left ${names.join(' and ')} to it`;
      break;
    }

    // --- be in the room --------------------------------------------------
    case RESPONSES.TALK: {
      if (landed) {
        for (const id of incident.participantIds) {
          gm(id, { trust: Math.round(4 + weight * 12), respect: Math.round(2 + weight * 5) },
            'Came and talked it through');
        }
        rememberAll(incident, MEMORY_TYPES.HEARD_OUT.key,
          'The GM came and heard them out', { cause });
        summary = summary || `Talked ${names.join(' and ')} round`;
      } else {
        for (const id of incident.participantIds) {
          gm(id, { respect: -Math.round(2 + weight * 5) }, 'Tried talking and got nowhere');
        }
        summary = `Tried talking to ${names.join(' and ')} and got nowhere`;
      }
      break;
    }

    case RESPONSES.MEDIATE: {
      if (landed) {
        const cool = -Math.round(10 + weight * 22);
        store.adjustRelationship(incident.participantIds[0], incident.participantIds[1],
          { hostility: cool, respect: 4 }, { reason: 'Talked out with the GM', cause });
        store.adjustRelationship(incident.participantIds[1], incident.participantIds[0],
          { hostility: cool, respect: 4 }, { reason: 'Talked out with the GM', cause });
        effects.push({ hostility: cool, why: 'Heat taken out of it on both sides' });
        for (const id of incident.participantIds) {
          gm(id, { trust: Math.round(5 + weight * 12), respect: Math.round(4 + weight * 10) },
            'Sat them both down and settled it');
        }
        rememberAll(incident, MEMORY_TYPES.HEARD_OUT.key,
          'The GM sat them both down and settled it', { cause });
        summary = summary || `Settled it between ${names.join(' and ')}`;
      } else {
        for (const id of incident.participantIds) {
          gm(id, { respect: -Math.round(3 + weight * 8) }, 'Tried to mediate and lost the room');
        }
        summary = `Could not get ${names.join(' and ')} to climb down`;
      }
      break;
    }

    // --- send somebody else ----------------------------------------------
    case RESPONSES.SECURITY: {
      for (const id of incident.participantIds) {
        gm(id, {
          trust: -Math.round(6 + weight * 14),
          respect: Math.round(2 + weight * 6),  // it worked, and they know it worked
        }, 'Had security pull them apart');
      }
      rememberAll(incident, MEMORY_TYPES.MANHANDLED.key,
        'Security pulled them apart on the GM’s say-so', { cause });
      summary = summary || `Security separated ${names.join(' and ')}`;
      break;
    }

    case RESPONSES.WARNING: {
      for (const id of incident.participantIds) {
        const w = store.requireWrestler(id);
        store.setDiscipline(id, { warnings: w.state.discipline.warnings + 1 },
          { reason: `Formal warning after ${INCIDENT_SPECS[incident.kind].noun}`, cause });
        // A professional takes a warning as the job. Somebody who is not takes
        // it personally, which is the whole reason the trait exists.
        const takesIt = w.identity.traits.professionalism >= 55;
        gm(id, takesIt
          ? { respect: Math.round(2 + weight * 6), trust: -2 }
          : { respect: -Math.round(2 + weight * 5), trust: -Math.round(4 + weight * 9) },
          takesIt ? 'Took the warning as read' : 'Did not take the warning well');
      }
      rememberAll(incident, MEMORY_TYPES.WARNED.key, 'Formally warned by the GM', { cause });
      summary = summary || `Warned ${names.join(' and ')}`;
      break;
    }

    // --- remove them ------------------------------------------------------
    case RESPONSES.EJECTION: {
      const show = liveShow();
      const cut = [];
      for (const id of incident.participantIds) {
        store.setDiscipline(id, { sentHomeFromShowId: show?.id || null },
          { reason: 'Sent home', cause });
        for (const seg of store.segmentsOfShow(show.id)) {
          if (seg.status !== SEGMENT_STATUS.BOOKED) continue;
          if (!seg.participants.some((p) => p.wrestlerId === id)) continue;
          store.cutSegment(seg.id, { reason: `${store.nameOf(id)} was sent home`, cause });
          cut.push(seg.name);
        }
        gm(id, {
          trust: -Math.round(12 + weight * 20),
          respect: -Math.round(4 + weight * 10),
        }, 'Sent home from the show');
        store.updateWrestlerState(id, { morale: clamp(store.requireWrestler(id).state.morale - 14) },
          { reason: 'Sent home', cause });
      }
      rememberAll(incident, MEMORY_TYPES.SENT_HOME.key, 'Sent home from the show', { cause });
      // People notice how their friends are treated.
      rippleToAllies(incident, -5, 'A friend was sent home', cause, effects);
      if (cut.length) effects.push({ why: `Cut from the card: ${cut.join(', ')}` });
      summary = summary || `Sent ${names.join(' and ')} home`;
      break;
    }

    case RESPONSES.SUSPENSION: {
      const until = store.today() + SUSPENSION_DAYS;
      for (const id of incident.participantIds) {
        store.setDiscipline(id, { suspendedUntilDay: until },
          { reason: `Suspended for ${SUSPENSION_DAYS} days`, cause });
        gm(id, {
          trust: -Math.round(16 + weight * 22),
          respect: -Math.round(6 + weight * 12),
        }, `Suspended until day ${until}`);
        store.updateWrestlerState(id, { morale: clamp(store.requireWrestler(id).state.morale - 22) },
          { reason: 'Suspended', cause });
        effects.push({ wrestlerId: id, suspendedUntilDay: until, why: 'Off television' });
      }
      rememberAll(incident, MEMORY_TYPES.SUSPENSION.key,
        `Suspended for ${SUSPENSION_DAYS} days`, { cause });
      rippleToAllies(incident, -8, 'A friend was suspended', cause, effects);
      summary = summary || `Suspended ${names.join(' and ')}`;
      break;
    }

    // --- put it on television ---------------------------------------------
    case RESPONSES.BOOK_MATCH: {
      const show = showWithRoom();
      const [aId, bId] = incident.participantIds;
      const segment = store.bookSegment({
        showId: show.id,
        format: 'singles',
        kind: SEGMENT_KINDS.MATCH,
        name: `${store.nameOf(aId)} vs ${store.nameOf(bId)}`,
        timeLimitSec: 12 * 60,
        participants: [{ wrestlerId: aId, side: 'a' }, { wrestlerId: bId, side: 'b' }],
      }, { cause });

      for (const id of incident.participantIds) {
        gm(id, { respect: Math.round(6 + weight * 14), trust: Math.round(2 + weight * 4) },
          'Gave them somewhere to put it');
        store.updateWrestlerState(id, { morale: clamp(store.requireWrestler(id).state.morale + 8) },
          { reason: 'Got the match out of it', cause });
      }
      rememberAll(incident, MEMORY_TYPES.REQUEST_GRANTED.key,
        `The GM turned it into a match on ${show.name}`, { cause });
      effects.push({ segmentId: segment.id, why: `Booked on ${show.name}` });
      summary = summary || `Booked ${store.nameOf(aId)} vs ${store.nameOf(bId)} on ${show.name}`;
      break;
    }

    default:
      throw new Error(`No handler for response "${key}"`);
  }

  // A refusal is only unblocked by something that changes the situation:
  // talking them round, or removing them from the card altogether.
  if (incident.blocksSegmentId) settleBlock(incident, key, landed, effects, cause);

  if (!landed && !spec.alwaysLands) {
    // It did not work, so the incident is still there to try something else on.
    incident.outcome = { landed: false, summary, effects };
    return { incident, landed: false, summary, effects };
  }

  store.resolveIncident(incidentId, { response: key, landed, summary, effects, cause });
  return { incident: store.getIncident(incidentId), landed, summary, effects };
}

/** What happens to the match somebody refused to go out for. */
function settleBlock(incident, key, landed, effects, cause) {
  const segment = store.getSegment(incident.blocksSegmentId);
  if (!segment || segment.status !== SEGMENT_STATUS.BOOKED) return;

  const talkedRound = landed && (key === RESPONSES.TALK || key === RESPONSES.MEDIATE);
  const forced = key === RESPONSES.SECURITY || key === RESPONSES.WARNING;

  if (talkedRound || forced) {
    store.unblockSegment(segment.id);
    effects.push({ segmentId: segment.id, why: `${segment.name} goes ahead` });
    return;
  }

  // Ignoring a refusal, or removing the person, means the match does not
  // happen. The card is shorter, and the night is graded on what aired.
  if (key === RESPONSES.IGNORE || key === RESPONSES.EJECTION || key === RESPONSES.SUSPENSION) {
    store.unblockSegment(segment.id);
    store.cutSegment(segment.id, {
      reason: `${store.nameOf(incident.instigatorId)} would not go out`,
      cause,
    });
    effects.push({ segmentId: segment.id, why: `${segment.name} never happened` });
  }
}

/** Friends take it personally when you come down on somebody. */
function rippleToAllies(incident, respectDelta, why, cause, effects) {
  const touched = new Set(incident.participantIds);
  for (const id of incident.participantIds) {
    for (const allyId of alliesOf(store.requireWrestler(id))) {
      if (touched.has(allyId) || !store.getWrestler(allyId)) continue;
      touched.add(allyId);
      store.adjustGmTie(allyId, { respect: respectDelta }, { reason: why, cause });
      effects.push({ wrestlerId: allyId, respect: respectDelta, why });
    }
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

export function install() {
  // The building carries on between matches, which is when there is time for
  // anything to happen in it.
  store.on(EVENT_TYPES.SEGMENT_COMPLETED, (event) => {
    const segment = store.getSegment(event.segmentId);
    if (!segment) return;
    checkConfrontation(segment, event.data.result || segment.result, { cause: event.id });
    checkFriction({ cause: event.id });
    checkComplaints({ cause: event.id });
    checkMeetingRequests({ cause: event.id });

    // Whoever is on next has to actually be willing to go out.
    const next = store.segmentsOfShow(segment.showId)
      .find((s) => s.status === SEGMENT_STATUS.BOOKED);
    if (next) checkRefusal(next, { cause: event.id });
  });

  // Doors open: the room fills and the opener has to be talked into going out.
  store.on(EVENT_TYPES.SHOW_STARTED, (event) => {
    checkFriction({ cause: event.id });
    checkMeetingRequests({ cause: event.id });
    const first = store.segmentsOfShow(event.showId)
      .find((s) => s.status === SEGMENT_STATUS.BOOKED);
    if (first) checkRefusal(first, { cause: event.id });
  });

  // Tier 7 decides whether the GM ever hears about any of it.
  store.on(EVENT_TYPES.NEWS_REACHED_GM, (event) => {
    const source = event.data.eventId ? store.getEvent(event.data.eventId) : null;
    const incidentId = source?.data?.incidentId;
    if (incidentId) store.discoverIncident(incidentId, { notificationId: event.data.notificationId });
  });

  // The night ends. Whatever is still open stops being answerable, and the
  // ones the GM knew about and sat on are the ones that cost them.
  store.on(EVENT_TYPES.SHOW_COMPLETED, (event) => {
    for (const incident of store.openIncidents()) {
      // Knowing about a serious thing and letting the night end on it is the
      // only version of this that costs anything. An incident nobody ever told
      // the GM about is not the GM's fault, and a grumble is not a grievance.
      const knew = incident.discoveredTick != null;
      if (knew && incident.severity >= LAPSE_MATTERS_ABOVE) {
        for (const id of incident.participantIds) {
          store.adjustGmTie(id, { respect: -Math.round(1 + (incident.severity / 100) * 6) },
            { reason: 'Knew about it all night and did nothing', cause: event.id });
          store.addMemory(id, memorySpec(MEMORY_TYPES.LEFT_TO_IT.key, {
            summary: `The GM knew about ${INCIDENT_SPECS[incident.kind].noun} and let the night end`,
            day: store.today(),
          }), { cause: event.id });
        }
      }
      if (incident.blocksSegmentId) store.unblockSegment(incident.blocksSegmentId);
      store.lapseIncident(incident.id, { cause: event.id });
    }
  });

  // A suspension that has run its course is over.
  store.on(EVENT_TYPES.CALENDAR_ADVANCED, (event) => {
    const today = store.today();
    for (const w of store.allWrestlers()) {
      const until = w.state.discipline.suspendedUntilDay;
      if (until != null && today >= until) {
        store.setDiscipline(w.id, { suspendedUntilDay: null },
          { reason: `${w.name}'s suspension is served`, cause: event.id });
      }
      if (w.state.discipline.sentHomeFromShowId) {
        store.setDiscipline(w.id, { sentHomeFromShowId: null }, { reason: '', cause: event.id });
      }
    }
  });
}
