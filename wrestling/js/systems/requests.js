// What the roster asks for.
//
// Every request is produced from the record: the rankings, the relationships,
// the memories, the card positions, the pay. RNG picks nothing. If a wrestler
// asks to face somebody, it is because of something that actually happened
// between them, and the request carries the reasons so the GM can see it.
//
// Two gates stand between wanting something and asking for it:
//
//   STRENGTH   how much the world justifies the ask. Pure world state.
//   VOICE      whether this person would say it out loud. Personality and
//              standing, the same rule as Tier 4 - a rookie rarely speaks up
//              however badly they want something, a superstar says it freely.
//
// A request is granted by the GM actually booking it, not by pressing a button.
// It can be refused outright, which is honest and costs less than letting it
// sit until the show passes. Being ignored is the worst of the three, and the
// one they remember longest.

import * as store from '../core/store.js';
import { EVENT_TYPES } from '../core/events.js';
import { REQUEST_KINDS, REQUEST_STATUS, REQUEST_LABEL, REQUEST_NOUN, PERSON_KINDS } from '../models/request.js';
import { MEMORY_TYPES } from '../models/memory.js';
import { RIVAL_THRESHOLD } from '../models/relationship.js';
import {
  statusRank, standingWeight, relationshipWith, memoryWeightOn, CAREER_RANK,
} from '../models/wrestler.js';
import { GRUDGE_TYPES } from '../models/memory.js';
import { expectedMinutes } from './disposition.js';
import { satisfactionOf, championshipAmbition, appearances, recentShows } from './satisfaction.js';
import { championIds } from '../models/title.js';

/** At most this many open requests from one wrestler at a time. */
export const MAX_OPEN_PER_WRESTLER = 2;
/** At most this many new requests from the whole roster after one show. */
export const MAX_NEW_PER_SHOW = 5;
/** After a straight refusal, they leave it alone for a while. */
export const DENIED_COOLDOWN_DAYS = 21;

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/**
 * How readily this person speaks up. Returns the strength a want must reach
 * before they will voice it: low means they say everything, high means they
 * keep it to themselves.
 */
export function voiceThreshold(w) {
  const t = w.identity.traits;
  const boldness = (
    w.identity.ego * 0.35
    + (100 - t.patience) * 0.25
    + (100 - t.respectForAuthority) * 0.25
    + w.identity.ambition * 0.15
  ) / 100;
  return clamp(74 - standingWeight(w) * 32 - boldness * 24, 10, 95);
}

function recentlyDenied(wrestlerId, kind) {
  const today = store.today();
  return store.allRequests().some((r) =>
    r.wrestlerId === wrestlerId && r.kind === kind
    && r.status === REQUEST_STATUS.DENIED
    && r.resolvedOnDay != null && today - r.resolvedOnDay < DENIED_COOLDOWN_DAYS);
}

/** Being ignored does not make somebody stop asking. It makes them louder. */
function ignoredBoost(wrestlerId, kind) {
  const today = store.today();
  const ignored = store.allRequests().filter((r) =>
    r.wrestlerId === wrestlerId && r.kind === kind
    && r.status === REQUEST_STATUS.IGNORED
    && r.resolvedOnDay != null && today - r.resolvedOnDay < 90);
  return Math.min(22, ignored.length * 11);
}

// ---------------------------------------------------------------------------
// Candidates. Each returns a request spec or null. None of them roll dice.
// ---------------------------------------------------------------------------

function wantTitleShot(w, sat) {
  const want = championshipAmbition(w.id);
  if (!want || want.holding) return null;
  const title = store.getTitle(want.titleId);
  if (!title) return null;
  if (championIds(title).includes(w.id)) return null;

  // Wanting a belt and having a case for one are different things. Somebody
  // outside the contention picture can be as ambitious as they like; they know
  // asking would make them look ridiculous, so they do not ask.
  const rank = w.standing.rank;
  const plausible = rank == null ? 0.5 : Math.max(0.12, 1 - (rank - 1) / 8);

  const strength = clamp(
    (want.urgency * 0.85 + (100 - sat.dimensions.championship.score) * 0.25) * plausible
  );
  return {
    kind: REQUEST_KINDS.TITLE_SHOT,
    titleId: title.id,
    strength,
    urgency: want.urgency,
    reasons: want.reasons,
    text: `${w.name} wants a shot at the ${title.shortName} title`,
  };
}

function wantMoreTvTime(w, sat) {
  const score = sat.dimensions.tvTime.score;
  if (score >= 45) return null;
  return {
    kind: REQUEST_KINDS.MORE_TV_TIME,
    strength: clamp((45 - score) * 1.7),
    urgency: clamp((45 - score) * 1.6),
    reasons: sat.dimensions.tvTime.reasons,
    text: `${w.name} wants more television time`,
  };
}

function wantLongerMatches(w, sat) {
  const apps = appearances(w.id).filter((a) => a.segment.kind === 'match');
  if (apps.length < 2) return null;
  const avgLimit = apps.reduce((t, a) => t + a.segment.timeLimitSec, 0) / apps.length / 60;
  const wanted = expectedMinutes(w);
  if (avgLimit >= wanted * 0.75) return null;
  const shortfall = 1 - avgLimit / wanted;
  return {
    kind: REQUEST_KINDS.MORE_SEGMENT_TIME,
    strength: clamp(shortfall * 115),
    urgency: clamp(shortfall * 100),
    reasons: [`Averaging ${Math.round(avgLimit)} minute limits, expects about ${Math.round(wanted)}`],
    text: `${w.name} wants longer matches`,
  };
}

function wantBetterRole(w, sat) {
  const score = sat.dimensions.role.score;
  if (score >= 42) return null;
  return {
    kind: REQUEST_KINDS.BETTER_ROLE,
    strength: clamp((42 - score) * 1.8),
    urgency: clamp((42 - score) * 1.7),
    reasons: sat.dimensions.role.reasons,
    text: `${w.name} wants a better spot on the card`,
  };
}

/** The rival they want to settle it with. Aggression decides face-or-avoid. */
function wantToFaceRival(w) {
  const t = w.identity.traits;
  const candidates = Object.entries(w.ties.relationships)
    .filter(([, rel]) => rel.hostility >= RIVAL_THRESHOLD)
    .sort((a, b) => b[1].hostility - a[1].hostility);
  if (!candidates.length) return null;

  const [targetId, rel] = candidates[0];
  if (!store.getWrestler(targetId)) return null;
  // Somebody with no fight in them wants the opposite of this.
  if (t.aggression < 40 && t.courage < 45) return null;

  const strength = clamp(rel.hostility * 0.75 + t.aggression * 0.25);
  const reasons = [`${rel.hostility} hostility toward ${store.nameOf(targetId)}`];
  const last = rel.history[rel.history.length - 1];
  if (last?.summary) reasons.push(last.summary);

  return {
    kind: REQUEST_KINDS.FACE_RIVAL,
    targetId,
    strength,
    urgency: clamp(rel.hostility),
    reasons,
    text: `${w.name} wants ${store.nameOf(targetId)} one on one`,
  };
}

/** Somebody they have a score to settle with, short of a full rivalry. */
function wantMatchWith(w) {
  const today = store.today();
  let best = null;
  for (const m of w.memory) {
    if (!GRUDGE_TYPES.includes(m.type)) continue;
    for (const targetId of m.aboutIds) {
      if (!store.getWrestler(targetId)) continue;
      const weight = memoryWeightOn(m, today);
      if (!best || weight > best.weight) best = { targetId, weight, memory: m };
    }
  }
  if (!best || best.weight < 30) return null;

  const rel = relationshipWith(w, best.targetId);
  const gap = CAREER_RANK[store.getWrestler(best.targetId).standing.careerStatus] - statusRank(w);
  const strength = clamp(
    best.weight * 0.6
    + Math.max(0, gap) * 6 * (w.identity.ambition / 100)
    + rel.hostility * 0.2
  );

  return {
    kind: REQUEST_KINDS.MATCH_WITH,
    targetId: best.targetId,
    strength,
    urgency: clamp(best.weight),
    reasons: [best.memory.summary],
    text: `${w.name} wants a match with ${store.nameOf(best.targetId)}`,
  };
}

/** Somebody they will not work with. Distrust, not heat, is what drives this. */
function wantToAvoid(w) {
  const t = w.identity.traits;
  const candidates = Object.entries(w.ties.relationships)
    .filter(([, rel]) => rel.trust <= 30 && rel.respect <= 45)
    .sort((a, b) => (a[1].trust + a[1].respect) - (b[1].trust + b[1].respect));
  if (!candidates.length) return null;

  const [targetId, rel] = candidates[0];
  if (!store.getWrestler(targetId)) return null;
  // Someone with fight in them wants to face this person, not dodge them.
  if (t.aggression >= 55 || t.courage >= 70) return null;

  const strength = clamp((100 - rel.trust) * 0.5 + (100 - rel.respect) * 0.3 + (100 - t.courage) * 0.2);
  const reasons = [`Trusts ${store.nameOf(targetId)} at ${rel.trust} and rates them at ${rel.respect}`];
  const cheated = w.memory.find((m) => m.type === MEMORY_TYPES.CHEATED.key && m.aboutIds.includes(targetId));
  if (cheated) reasons.push(cheated.summary);

  return {
    kind: REQUEST_KINDS.AVOID,
    targetId,
    strength,
    urgency: clamp(strength * 0.8),
    reasons,
    text: `${w.name} does not want to be booked with ${store.nameOf(targetId)} again`,
  };
}

/** Somebody they would rather work alongside than against. */
function wantToTagWith(w, sat) {
  const candidates = Object.entries(w.ties.relationships)
    .filter(([, rel]) => rel.affinity >= 45 && rel.trust >= 55)
    .sort((a, b) => (b[1].affinity + b[1].trust) - (a[1].affinity + a[1].trust));
  if (!candidates.length) return null;

  const [targetId, rel] = candidates[0];
  const other = store.getWrestler(targetId);
  if (!other) return null;

  // Wanting a partner is mostly something you feel when going it alone is not
  // working, or when you are the sort of person who likes company.
  const struggling = 100 - sat.dimensions.booking.score;
  const strength = clamp(
    rel.affinity * 0.4 + rel.trust * 0.2
    + struggling * 0.25 + w.identity.traits.sociability * 0.2 - 22
  );

  return {
    kind: REQUEST_KINDS.TAG_WITH,
    targetId,
    strength,
    urgency: clamp(strength * 0.8),
    reasons: [`Trusts ${other.name} at ${rel.trust}, affinity ${rel.affinity}`],
    text: `${w.name} wants to form a team with ${other.name}`,
  };
}

const CANDIDATES = [
  wantTitleShot, wantMoreTvTime, wantLongerMatches, wantBetterRole,
  wantToFaceRival, wantMatchWith, wantToAvoid, wantToTagWith,
];

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/** Everything this wrestler currently wants, strongest first. Pure. */
export function wantsOf(wrestlerId) {
  const w = store.requireWrestler(wrestlerId);
  const sat = satisfactionOf(wrestlerId);
  return CANDIDATES
    .map((fn) => fn(w, sat))
    .filter(Boolean)
    .map((spec) => ({ ...spec, strength: clamp(spec.strength + ignoredBoost(wrestlerId, spec.kind)) }))
    .sort((a, b) => b.strength - a.strength);
}

/** The ones they would actually say out loud. */
export function voicedWantsOf(wrestlerId) {
  const w = store.requireWrestler(wrestlerId);
  const threshold = voiceThreshold(w);
  return wantsOf(wrestlerId).filter((want) => want.strength >= threshold);
}

/**
 * Work down the roster and let people speak.
 * Deterministic: the same world produces the same requests.
 */
export function generateRequests({ cause = null } = {}) {
  const made = [];
  const candidates = [];

  for (const w of store.allWrestlers()) {
    const open = store.openRequestsFor(w.id);
    if (open.length >= MAX_OPEN_PER_WRESTLER) continue;
    const openKinds = new Set(open.map((r) => r.kind));

    for (const want of voicedWantsOf(w.id)) {
      if (openKinds.has(want.kind)) continue;
      if (recentlyDenied(w.id, want.kind)) continue;
      candidates.push({ wrestlerId: w.id, want, room: MAX_OPEN_PER_WRESTLER - open.length });
    }
  }

  // Loudest first across the whole roster, so the inbox is the things that
  // matter rather than everything anybody mildly wishes for.
  candidates.sort((a, b) => b.want.strength - a.want.strength);

  const perWrestler = new Map();
  for (const { wrestlerId, want, room } of candidates) {
    if (made.length >= MAX_NEW_PER_SHOW) break;
    const used = perWrestler.get(wrestlerId) || 0;
    if (used >= room) continue;
    perWrestler.set(wrestlerId, used + 1);
    made.push(store.makeRequestFor({ wrestlerId, ...want }, { cause }));
  }
  return made;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** Does this booking give somebody what they asked for? */
function bookingSatisfies(request, segment) {
  const ids = segment.participants.map((p) => p.wrestlerId);
  if (!ids.includes(request.wrestlerId)) return false;

  const sides = {};
  for (const p of segment.participants) (sides[p.side] ||= []).push(p.wrestlerId);
  const mySide = segment.participants.find((p) => p.wrestlerId === request.wrestlerId)?.side;
  const opponents = Object.entries(sides).filter(([s]) => s !== mySide).flatMap(([, v]) => v);
  const partners = (sides[mySide] || []).filter((id) => id !== request.wrestlerId);

  switch (request.kind) {
    case REQUEST_KINDS.TITLE_SHOT:
      return segment.titleId === request.titleId;
    case REQUEST_KINDS.FACE_RIVAL:
    case REQUEST_KINDS.MATCH_WITH:
      return opponents.includes(request.targetId);
    case REQUEST_KINDS.TAG_WITH:
      return partners.includes(request.targetId);
    case REQUEST_KINDS.MORE_SEGMENT_TIME:
      return segment.kind === 'match'
        && segment.timeLimitSec >= expectedMinutes(store.getWrestler(request.wrestlerId)) * 60;
    case REQUEST_KINDS.MORE_TV_TIME:
    case REQUEST_KINDS.BETTER_ROLE:
      return false;   // these are judged over a whole show, below
    case REQUEST_KINDS.AVOID:
      return false;   // an avoid request is kept by NOT booking it
    default:
      return false;
  }
}

/** Booking the very thing they asked to avoid is worse than ignoring them. */
function bookingBreaks(request, segment) {
  if (request.kind !== REQUEST_KINDS.AVOID) return false;
  const ids = segment.participants.map((p) => p.wrestlerId);
  return ids.includes(request.wrestlerId) && ids.includes(request.targetId);
}

function payOff(request, outcome, event) {
  const w = store.getWrestler(request.wrestlerId);
  if (!w) return;
  const weight = 0.5 + request.urgency / 100;

  const table = {
    [REQUEST_STATUS.GRANTED]: { trust: 8, respect: 6, morale: 9, memory: MEMORY_TYPES.REQUEST_GRANTED.key, mood: 'confident' },
    [REQUEST_STATUS.DENIED]: { trust: -3, respect: -2, morale: -5, memory: MEMORY_TYPES.REQUEST_DENIED.key, mood: 'restless' },
    [REQUEST_STATUS.IGNORED]: { trust: -5, respect: -4, morale: -6, memory: MEMORY_TYPES.REQUEST_IGNORED.key, mood: 'frustrated' },
  }[outcome];
  if (!table) return;

  store.adjustGmTie(w.id, {
    trust: Math.round(table.trust * weight),
    respect: Math.round(table.respect * weight),
  }, { reason: `${REQUEST_LABEL[request.kind]} ${outcome}`, cause: event?.id ?? null });

  store.updateWrestlerState(w.id, {
    morale: w.state.morale + table.morale * weight,
    mood: table.mood,
  }, { reason: `${REQUEST_LABEL[request.kind]} ${outcome}`, cause: event?.id ?? null });

  store.addMemory(w.id, {
    type: table.memory,
    summary: outcome === REQUEST_STATUS.GRANTED
      ? `Asked for ${REQUEST_NOUN[request.kind]} and got it`
      : outcome === REQUEST_STATUS.DENIED
        ? `Asked for ${REQUEST_NOUN[request.kind]} and was told no`
        : `Asked for ${REQUEST_NOUN[request.kind]} and never heard back`,
    aboutIds: request.targetId ? [request.targetId] : [],
  }, { cause: event?.id ?? null });
}

/** The GM says no to somebody's face. Honest, and cheaper than silence. */
export function denyRequest(requestId, { reason = '' } = {}) {
  const request = store.getRequest(requestId);
  if (!request) return null;
  const event = store.resolveRequest(requestId, REQUEST_STATUS.DENIED, { reason });
  payOff(request, REQUEST_STATUS.DENIED, event);
  return event;
}

export function install() {
  // A booking can grant a request, or break one.
  store.on(EVENT_TYPES.SEGMENT_BOOKED, (event) => {
    const segment = store.getSegment(event.segmentId);
    if (!segment) return;
    for (const request of store.openRequests()) {
      if (bookingSatisfies(request, segment)) {
        const done = store.resolveRequest(request.id, REQUEST_STATUS.GRANTED, {
          segmentId: segment.id,
          reason: `${store.nameOf(request.wrestlerId)} got what they asked for`,
          cause: event.id,
        });
        payOff(request, REQUEST_STATUS.GRANTED, done);
      } else if (bookingBreaks(request, segment)) {
        const done = store.resolveRequest(request.id, REQUEST_STATUS.IGNORED, {
          segmentId: segment.id,
          reason: `${store.nameOf(request.wrestlerId)} was booked with ${store.nameOf(request.targetId)} anyway`,
          cause: event.id,
        });
        payOff(request, REQUEST_STATUS.IGNORED, done);
      }
    }
  });

  // The show goes off the air: anything still open was never answered, and
  // then the roster has another look at where it stands.
  store.on(EVENT_TYPES.SHOW_COMPLETED, (event) => {
    const show = store.getShow(event.showId);
    // Somebody with two requests hanging is annoyed once, not twice. Without
    // this a wrestler who asks for a lot loses faith in the GM twice as fast as
    // one who asks for little, which is exactly backwards.
    const stung = new Set();

    for (const request of store.openRequests()) {
      if (request.day > (show?.day ?? store.today())) continue;   // made after the show
      // Television time and card position are judged across the whole night.
      const apps = appearances(request.wrestlerId, [show]).length;
      if (request.kind === REQUEST_KINDS.MORE_TV_TIME && apps > 0) {
        const got = appearances(request.wrestlerId, [show]).reduce((t, a) => t + a.seconds, 0);
        if (got >= expectedMinutes(store.getWrestler(request.wrestlerId)) * 60) {
          const done = store.resolveRequest(request.id, REQUEST_STATUS.GRANTED, {
            reason: `${store.nameOf(request.wrestlerId)} got the television time they wanted`, cause: event.id,
          });
          payOff(request, REQUEST_STATUS.GRANTED, done);
          continue;
        }
      }
      if (request.kind === REQUEST_KINDS.BETTER_ROLE && apps > 0) {
        const best = Math.max(...appearances(request.wrestlerId, [show]).map((a) => a.slot));
        if (best >= 0.7) {
          const done = store.resolveRequest(request.id, REQUEST_STATUS.GRANTED, {
            reason: `${store.nameOf(request.wrestlerId)} was moved up the card`, cause: event.id,
          });
          payOff(request, REQUEST_STATUS.GRANTED, done);
          continue;
        }
      }
      if (request.kind === REQUEST_KINDS.AVOID) {
        // Kept simply by not booking it. Quietly honoured.
        const done = store.resolveRequest(request.id, REQUEST_STATUS.GRANTED, {
          reason: `${store.nameOf(request.wrestlerId)} was kept away from ${store.nameOf(request.targetId)}`,
          cause: event.id,
        });
        payOff(request, REQUEST_STATUS.GRANTED, done);
        continue;
      }

      const done = store.resolveRequest(request.id, REQUEST_STATUS.IGNORED, {
        reason: `${store.nameOf(request.wrestlerId)} never heard back`, cause: event.id,
      });
      if (!stung.has(request.wrestlerId)) {
        stung.add(request.wrestlerId);
        payOff(request, REQUEST_STATUS.IGNORED, done);
      }
    }

    generateRequests({ cause: event.id });
  });
}
