// What everybody else does about it.
//
// Tier 8 made things go wrong. This is the tier where the rest of the locker
// room is in the room too, and a fight between two people stops being a fight
// between two people.
//
//   Croft jumps Vance
//     -> Sparrow pulls him off          (a save: courage, and the code)
//        -> Wren goes after Sparrow     (an interference: heat)
//           -> the GM hears about it, late, from somebody in catering
//
// Nothing here is new data. Every motive reads something an earlier tier
// already tracks: affinity and hostility from Tier 5, loyalty, jealousy,
// vindictiveness, aggression and courage from Tier 4, grudge memories from
// Tier 5, the room from Tier 7, the incident from Tier 8. The only genuinely
// new facts are alignment and faction membership, and both are authored
// character rather than anything that has happened.
//
// Two rules hold the whole thing together:
//
//   1. **Deciding not to act is a reaction.** An ally who stood and watched is
//      recorded, and the person who was not helped remembers it. Half the
//      bullets in this tier are about people NOT getting involved, and a system
//      that only logged the heroics would be missing the point.
//   2. **Courage decides whether you act now; vindictiveness decides whether
//      you act later.** Somebody with no nerve for a fight in progress can
//      still come looking twenty minutes afterwards, which is where delayed
//      reactions come from.

import * as store from '../core/store.js';
import { EVENT_TYPES, VISIBILITY } from '../core/events.js';
import {
  INCIDENT_KINDS, INCIDENT_SPECS, INCIDENT_STATUS, severityLabel,
} from '../models/incident.js';
import {
  REACTION_KINDS, REACTION_SPECS, MOTIVES, MOTIVE_LABEL, reactionSpec,
} from '../models/reaction.js';
import { MEMORY_TYPES, memorySpec } from '../models/memory.js';
import {
  relationshipWith, memoryWeightOn, isFace, canBeBooked, ALIGNMENT,
} from '../models/wrestler.js';
import { locationName, travelSeconds } from '../models/location.js';

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/** Below this nobody is pulled in strongly enough to be worth a roll. */
export const PULL_FLOOR = 24;

/**
 * Below this, somebody who did not get involved is not a story.
 *
 * Without this line every babyface in the room quietly accrues a "stood there
 * and watched" against every other babyface, and the whole locker room drifts
 * apart over a couple of months for no reason anybody could name. Standing
 * there only counts when they had a real reason to move.
 */
export const STOOD_BY_FLOOR = 38;

/** How far a chain can run before the night stops being a wrestling show. */
export const MAX_CHAIN_DEPTH = 3;

/** How many people can get involved in any one incident. */
export const MAX_REACTORS = 3;

/**
 * How much of the pull becomes somebody actually moving.
 *
 * Applied to a pull that SATURATES rather than one that scales linearly, which
 * matters more than the number: a linear curve makes the courageous best friend
 * of the man being jumped a coin flip, and he should be a near certainty. The
 * volume knob for this tier is PULL_FLOOR - who is considered at all - not how
 * reliably somebody who genuinely cares follows through.
 */
export const ACT_RATE = 0.92;

/** A pull at or above this is somebody fully committed. */
export const FULL_COMMITMENT = 70;

/** Nerve below this and they are not going anywhere near it. */
export const NERVE_FLOOR = 30;

/** A slow burn lands somewhere in here, in seconds. */
export const DELAY_MIN_SEC = 240;
export const DELAY_MAX_SEC = 900;

/**
 * What it takes to cross the building for somebody else's fight.
 *
 * Much higher than the floor for somebody already standing there. Getting
 * involved in front of you is a decision made in a second; hearing about it two
 * rooms away and going anyway is a different kind of decision, and only a
 * stablemate or somebody genuinely close makes it.
 */
export const LATE_FLOOR = 52;

/** How long they take to get themselves together before setting off. */
export const HEARD_LAG_MIN_SEC = 60;
export const HEARD_LAG_MAX_SEC = 240;

// ---------------------------------------------------------------------------
// Motive: who would get involved, for whom, and why
// ---------------------------------------------------------------------------

/**
 * How strongly one person is pulled toward helping another, or toward going
 * after them. Positive is for them, negative is against.
 *
 * Every term reads a number an earlier tier owns. Nothing here is new.
 */
export function pullToward(candidate, otherId) {
  const other = store.getWrestler(otherId);
  if (!other || candidate.id === otherId) return { score: 0, reasons: [] };

  const rel = relationshipWith(candidate, otherId);
  const traits = candidate.identity.traits;
  const today = store.today();
  const reasons = [];
  let score = 0;

  const add = (weight, motive, detail) => {
    if (Math.abs(weight) < 3) return;
    score += weight;
    reasons.push({ motive, label: MOTIVE_LABEL[motive], detail, weight: Math.round(weight) });
  };

  // --- reasons to be on their side ---

  // Tier 5's affinity, scaled by whether this is a person who gets involved.
  if (rel.affinity > 0) {
    add(rel.affinity * (0.42 + traits.loyalty * 0.004),
      MOTIVES.ALLY, `Affinity ${rel.affinity}, loyalty ${traits.loyalty}`);
  }

  // A stable backs its own whether or not they like each other, which is why
  // faction is a separate term from affinity rather than a shorthand for it.
  if (store.sameFaction(candidate.id, otherId)) {
    const faction = store.factionOf(candidate.id);
    const isLeader = faction.leaderId === otherId;
    add(34 + (isLeader ? 14 : 0) + traits.loyalty * 0.14,
      MOTIVES.FACTION, isLeader ? `${faction.name}, and that is the leader` : faction.name);
  }

  // The code of the business: one babyface does not watch another get jumped.
  if (isFace(candidate) && isFace(other)) {
    add(12 + traits.professionalism * 0.12 + traits.courage * 0.08,
      MOTIVES.CODE, 'Both babyfaces');
  }

  // Some people simply cannot keep out of things.
  if (traits.loyalty >= 70 && traits.aggression >= 45) {
    add((traits.loyalty - 70) * 0.35, MOTIVES.LOYALTY, `Loyalty ${traits.loyalty}`);
  }

  // --- reasons to be against them ---

  if (rel.hostility > 0) {
    add(-rel.hostility * (0.45 + traits.vindictiveness * 0.004),
      MOTIVES.RIVALRY, `Hostility ${rel.hostility}, vindictiveness ${traits.vindictiveness}`);
  }

  if (rel.affinity < 0) {
    add(rel.affinity * 0.35, MOTIVES.RIVALRY, `Cannot stand them (${rel.affinity})`);
  }

  // A fresh grudge is sharper than an old one, and memoryWeightOn decays it.
  const grudge = candidate.memory
    .filter((m) => m.aboutIds?.includes(otherId))
    .map((m) => ({ m, weight: memoryWeightOn(m, today) }))
    .sort((a, b) => b.weight - a.weight)[0];
  if (grudge && grudge.weight >= 30 && rel.hostility > rel.affinity) {
    add(-grudge.weight * 0.28, MOTIVES.GRUDGE, grudge.m.summary);
  }

  // Resenting somebody above you is its own reason to enjoy their trouble.
  if (traits.jealousy >= 55 && (other.standing.rank ?? 99) < (candidate.standing.rank ?? 99)) {
    add(-(traits.jealousy - 55) * 0.7, MOTIVES.JEALOUSY,
      `Ranked #${other.standing.rank} to their #${candidate.standing.rank ?? '-'}`);
  }

  return { score, reasons };
}

/**
 * Whether they have it in them to step into this one.
 *
 * Courage against how bad it is, with aggression as the part of somebody that
 * does not stop to think. A crisis needs real nerve; a row in catering does not.
 */
export function nerveFor(candidate, incident) {
  const t = candidate.identity.traits;
  const physical = incident.kind === INCIDENT_KINDS.FIGHT;
  const risk = incident.severity * (physical ? 0.75 : 0.42);
  return Math.round(clamp(
    t.courage * 0.82 + t.aggression * 0.3 + t.volatility * 0.12 - risk
  ));
}

/**
 * Every incident in the same chain as this one, root and all.
 *
 * A chain is one melee spread over several entries in the log, so being "in"
 * two links of it is not being in two fights - it is being in this one twice.
 */
export function chainIds(incident) {
  const root = store.incidentChain(incident.id)[0] || incident;
  const ids = new Set([root.id]);
  const walk = (id) => {
    for (const child of store.incidentsCausedBy(id)) {
      if (ids.has(child.id)) continue;
      ids.add(child.id);
      walk(child.id);
    }
  };
  walk(root.id);
  return ids;
}

/** Nobody is in two fights at once - but one chain is one fight. */
export function inAnOpenIncident(wrestlerId, except = null) {
  const excluded = except instanceof Set
    ? except
    : new Set(except ? [except] : []);
  return store.openIncidents().some((i) => !excluded.has(i.id)
    && INCIDENT_SPECS[i.kind].between
    && i.participantIds.includes(wrestlerId));
}

/**
 * Everybody who could plausibly get involved, strongest pull first.
 *
 * The room is the gate: you cannot pull somebody off a man you are not standing
 * next to. Somebody elsewhere who would have waded in never even appears here,
 * which is a quiet consequence of Tier 7 that nobody has to code for.
 */
export function candidatesFor(incident) {
  const involved = new Set(incident.participantIds);
  const already = new Set(incident.reactions.map((r) => r.wrestlerId));
  const mine = chainIds(incident);
  const day = store.today();

  return store.whoIsIn(incident.locationId)
    .filter((w) => !involved.has(w.id) && !already.has(w.id) && canBeBooked(w, day))
    .filter((w) => !inAnOpenIncident(w.id, mine))
    .map((w) => {
      // Which of the people in it they care about most, and which way.
      const pulls = incident.participantIds
        .map((id) => ({ id, ...pullToward(w, id) }))
        .sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
      const top = pulls[0];
      return {
        wrestler: w,
        aboutId: top?.id || null,
        score: Math.abs(top?.score || 0),
        forThem: (top?.score || 0) > 0,
        reasons: top?.reasons || [],
        nerve: nerveFor(w, incident),
      };
    })
    .filter((c) => c.aboutId)
    .sort((a, b) => b.score - a.score);
}

/**
 * How likely somebody is to actually move, given how much they care and
 * whether they have the nerve.
 *
 * Both terms saturate: past a certain pull they are going whatever happens, and
 * past a certain nerve the fight itself is not what is stopping them.
 */
export function actChance(candidate) {
  const drive = Math.min(1, candidate.score / FULL_COMMITMENT);
  const composure = Math.min(1, 0.45 + candidate.nerve / 90);
  return Math.max(0, Math.min(1, drive * composure * ACT_RATE));
}

/** What a candidate would do, given who they care about and which way. */
function kindFor(candidate, incident) {
  const { aboutId, forThem } = candidate;
  if (!forThem) return REACTION_KINDS.INTERFERE;
  // Helping the person being gone after is a save; helping whoever started it
  // is piling in.
  return aboutId === incident.targetId || aboutId !== incident.instigatorId
    ? REACTION_KINDS.SAVE
    : REACTION_KINDS.JOIN;
}

// ---------------------------------------------------------------------------
// Deciding
// ---------------------------------------------------------------------------

/**
 * Work out what the room does about an incident, and queue it.
 *
 * Returns the reactions decided. Anything with a `dueTick` in the future has
 * not happened yet - it is somebody who is going to come looking later.
 */
export function react(incident, { cause = null } = {}) {
  if (!INCIDENT_SPECS[incident.kind].between) return [];
  if (incident.chainDepth >= MAX_CHAIN_DEPTH) return [];
  const rng = store.getRng();
  const out = [];

  const candidates = candidatesFor(incident).slice(0, MAX_REACTORS + 2);

  for (const candidate of candidates) {
    if (out.length >= MAX_REACTORS) break;
    if (candidate.score < PULL_FLOOR) continue;

    const { wrestler: w, nerve } = candidate;
    const wants = kindFor(candidate, incident);
    const reasons = [...candidate.reasons];

    // No nerve for it. Which of the two ways that goes is character: somebody
    // who does not want to be anywhere near it leaves, somebody who wanted to
    // help and could not stands there and has to live with it.
    if (nerve < NERVE_FLOOR) {
      const bottles = w.identity.traits.courage < 40;
      const kind = bottles && wants !== REACTION_KINDS.INTERFERE
        ? REACTION_KINDS.AVOIDED
        : REACTION_KINDS.STOOD_BY;
      if (kind === REACTION_KINDS.STOOD_BY && candidate.score < STOOD_BY_FLOOR) continue;
      reasons.push({
        motive: null,
        label: bottles ? 'No stomach for it' : 'Thought better of it',
        detail: `Courage ${w.identity.traits.courage} against a ${severityLabel(incident.severity).toLowerCase()}`,
        weight: -(NERVE_FLOOR - nerve),
      });
      out.push(store.addReaction(incident.id, {
        wrestlerId: w.id, kind,
        forId: candidate.forThem ? candidate.aboutId : null,
        againstId: candidate.forThem ? null : candidate.aboutId,
        score: Math.round(candidate.score), nerve, reasons,
      }, { cause }));
      continue;
    }

    // Nerve enough, but the pull still has to beat a roll.
    if (!rng.chance(actChance(candidate))) {
      // They had a reason and did not use it. That is a reaction too, and the
      // person they did not help is going to notice - but only if the reason
      // was a real one. A passing acquaintance not wading in is just a Tuesday.
      if (candidate.score < STOOD_BY_FLOOR) continue;
      out.push(store.addReaction(incident.id, {
        wrestlerId: w.id,
        kind: REACTION_KINDS.STOOD_BY,
        forId: candidate.forThem ? candidate.aboutId : null,
        againstId: candidate.forThem ? null : candidate.aboutId,
        score: Math.round(candidate.score), nerve, reasons,
      }, { cause }));
      continue;
    }

    // Somebody short on nerve but long on spite does not do it here and now.
    // They wait, and they come back to it.
    //
    // Only an INTERFERENCE can smoulder. Piling in on a fight that is happening
    // now is now or never, and a save that arrives ten minutes late is not a
    // save - by then it is over and somebody has already taken their beating.
    const slowBurn = wants === REACTION_KINDS.INTERFERE
      && nerve < 52
      && w.identity.traits.vindictiveness >= 60;
    const delay = slowBurn
      ? rng.range(DELAY_MIN_SEC, DELAY_MAX_SEC)
      : 0;
    if (slowBurn) {
      reasons.push({
        motive: null,
        label: 'Waits for their moment',
        detail: `Vindictiveness ${w.identity.traits.vindictiveness}, and not here and now`,
        weight: 0,
      });
    }

    out.push(store.addReaction(incident.id, {
      wrestlerId: w.id,
      kind: wants,
      forId: candidate.forThem ? candidate.aboutId : null,
      againstId: candidate.forThem ? null : candidate.aboutId,
      score: Math.round(candidate.score), nerve, reasons,
      dueTick: store.tick() + delay,
    }, { cause }));
  }

  // Somebody elsewhere in the building may hear and come anyway.
  const late = reactLate(incident, { cause });
  if (late) out.push(late);

  // Everything that is not a slow burn happens straight away.
  for (const reaction of out) {
    if (reaction.dueTick <= store.tick()) perform(reaction, { cause });
  }
  return out;
}

/**
 * Somebody who was not in the room, heard, and came.
 *
 * This is where a reaction is genuinely delayed rather than merely late: they
 * have to be told, and then they have to walk, and Tier 7 already knows how
 * long both of those take. By the time they get there it may be over, which is
 * its own kind of answer.
 *
 * One per incident. A room filling up with latecomers is a riot, not a show.
 */
export function reactLate(incident, { cause = null } = {}) {
  const rng = store.getRng();
  const involved = new Set(incident.participantIds);
  const already = new Set(incident.reactions.map((r) => r.wrestlerId));
  const mine = chainIds(incident);
  const day = store.today();

  const best = store.allWrestlers()
    .filter((w) => !involved.has(w.id) && !already.has(w.id) && canBeBooked(w, day))
    .filter((w) => !inAnOpenIncident(w.id, mine))
    .filter((w) => store.locationOf(w.id) !== incident.locationId)
    .map((w) => {
      const pulls = incident.participantIds
        .map((id) => ({ id, ...pullToward(w, id) }))
        .sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
      const top = pulls[0];
      return {
        wrestler: w,
        aboutId: top?.id || null,
        score: Math.abs(top?.score || 0),
        forThem: (top?.score || 0) > 0,
        reasons: top?.reasons || [],
        nerve: nerveFor(w, incident),
      };
    })
    .filter((c) => c.aboutId && c.score >= LATE_FLOOR && c.nerve >= NERVE_FLOOR)
    .sort((a, b) => b.score - a.score)[0];
  if (!best) return null;

  const from = store.locationOf(best.wrestler.id);
  const travel = travelSeconds(from, incident.locationId);
  if (!Number.isFinite(travel)) return null;
  if (!rng.chance(actChance(best))) return null;

  const lag = rng.range(HEARD_LAG_MIN_SEC, HEARD_LAG_MAX_SEC);
  const reasons = [...best.reasons, {
    motive: null,
    label: 'Heard about it',
    detail: `Was in ${locationName(from)}, ${Math.round(travel)}s away`,
    weight: 0,
  }];

  return store.addReaction(incident.id, {
    wrestlerId: best.wrestler.id,
    kind: kindFor(best, incident),
    forId: best.forThem ? best.aboutId : null,
    againstId: best.forThem ? null : best.aboutId,
    score: Math.round(best.score),
    nerve: best.nerve,
    reasons,
    dueTick: store.tick() + travel + lag,
  }, { cause });
}

// ---------------------------------------------------------------------------
// Doing it
// ---------------------------------------------------------------------------

/** The name of the thing, for a log line somebody has to read. */
function describe(reaction, incident) {
  const who = store.nameOf(reaction.wrestlerId);
  const about = store.nameOf(reaction.forId || reaction.againstId);
  switch (reaction.kind) {
    case REACTION_KINDS.SAVE: return `${who} pulls ${about} out of it`;
    case REACTION_KINDS.JOIN: return `${who} piles in alongside ${about}`;
    case REACTION_KINDS.INTERFERE: return `${who} goes after ${about}`;
    case REACTION_KINDS.STOOD_BY: return `${who} stands there and watches`;
    default: return `${who} walks the other way`;
  }
}

/**
 * Carry out a reaction: change the relationships, write the memories, and
 * where it applies, start the next incident in the chain.
 */
export function perform(reaction, { cause = null } = {}) {
  const incident = store.getIncident(reaction.incidentId);
  if (!incident || reaction.tick != null) return null;

  const spec = reactionSpec(reaction.kind);
  const actorId = reaction.wrestlerId;
  const day = store.today();
  const weight = incident.severity / 100;
  let spawned = null;

  const event = store.emit(EVENT_TYPES.INCIDENT_REACTION, {
    summary: describe(reaction, incident),
    newsSummary: describe(reaction, incident),
    actorId,
    subjects: [actorId, reaction.forId, reaction.againstId].filter(Boolean),
    showId: incident.showId,
    locationId: incident.locationId,
    visibility: VISIBILITY.BACKSTAGE,
    cause: cause || incident.startedEventId,
    data: {
      incidentId: incident.id, reactionId: reaction.id, kind: reaction.kind,
      forId: reaction.forId, againstId: reaction.againstId,
      motives: reaction.reasons.map((r) => r.motive).filter(Boolean),
      delayedBySec: reaction.dueTick - reaction.raisedTick,
    },
  });

  switch (reaction.kind) {
    // --- pulled them out of it ---
    case REACTION_KINDS.SAVE: {
      const savedId = reaction.forId;
      store.adjustRelationship(savedId, actorId,
        { affinity: Math.round(14 + weight * 20), trust: Math.round(10 + weight * 16), respect: 6 },
        { reason: `${store.nameOf(actorId)} got them out of it`, cause: event.id });
      store.addMemory(savedId, memorySpec(MEMORY_TYPES.SAVE.key, {
        summary: `${store.nameOf(actorId)} pulled them out of ${INCIDENT_SPECS[incident.kind].noun}`,
        aboutIds: [actorId], day,
      }), { cause: event.id });

      // And now whoever was doing the jumping has a problem with the saver.
      for (const otherId of incident.participantIds) {
        if (otherId === savedId) continue;
        store.adjustRelationship(otherId, actorId,
          { hostility: Math.round(12 + weight * 22), affinity: -8 },
          { reason: 'Got in the way', cause: event.id });
      }
      // Whoever was doing the jumping, which is not always the instigator of
      // record: in a two-handed row the saver steps in against the other one.
      const aggressorId = incident.participantIds
        .find((id) => id !== savedId && id !== actorId);
      spawned = spawnFrom(incident, actorId, aggressorId, { cause: event.id });
      break;
    }

    // --- piled in ---
    case REACTION_KINDS.JOIN: {
      const withId = reaction.forId;
      store.addParticipant(incident.id, actorId);
      store.raiseSeverity(incident.id, 10 + weight * 14,
        { reason: `${store.nameOf(actorId)} makes it two on one`, cause: event.id });

      store.adjustRelationship(withId, actorId,
        { affinity: Math.round(8 + weight * 12), trust: 8 },
        { reason: 'Backed them up', cause: event.id });

      for (const otherId of incident.participantIds) {
        if (otherId === withId || otherId === actorId) continue;
        const rel = relationshipWith(store.requireWrestler(otherId), actorId);
        // An ally piling in against you is not a row, it is a betrayal.
        const betrayed = rel.affinity >= 40;
        store.adjustRelationship(otherId, actorId, {
          hostility: Math.round((betrayed ? 22 : 14) + weight * 20),
          affinity: betrayed ? -40 : -12,
          trust: betrayed ? -35 : -12,
        }, { reason: betrayed ? 'Somebody they trusted piled in' : 'Piled in against them', cause: event.id });

        if (betrayed) {
          store.addMemory(otherId, memorySpec(MEMORY_TYPES.BETRAYAL.key, {
            summary: `${store.nameOf(actorId)} piled in against them in ${locationName(incident.locationId)}`,
            aboutIds: [actorId], day,
          }), { cause: event.id });
        }
      }
      break;
    }

    // --- came in and went after somebody ---
    case REACTION_KINDS.INTERFERE: {
      const againstId = reaction.againstId;
      store.adjustRelationship(againstId, actorId,
        { hostility: Math.round(20 + weight * 26), affinity: -16, trust: -14 },
        { reason: 'Jumped while they were already in something', cause: event.id });
      spawned = spawnFrom(incident, actorId, againstId, { cause: event.id });
      break;
    }

    // --- did nothing ---
    case REACTION_KINDS.STOOD_BY: {
      const letDownId = reaction.forId;
      if (letDownId) {
        const rel = relationshipWith(store.requireWrestler(letDownId), actorId);
        // The closer they were, the worse it is that they did not move.
        const closeness = Math.max(0, rel.affinity) / 100;
        store.adjustRelationship(letDownId, actorId, {
          affinity: -Math.round(6 + closeness * 22),
          trust: -Math.round(8 + closeness * 24),
          respect: -Math.round(3 + closeness * 8),
        }, { reason: `${store.nameOf(actorId)} watched and did nothing`, cause: event.id });

        if (rel.affinity >= 25) {
          store.addMemory(letDownId, memorySpec(MEMORY_TYPES.STOOD_BY.key, {
            summary: `${store.nameOf(actorId)} stood there while it happened`,
            aboutIds: [actorId], day,
          }), { cause: event.id });
        }
      }
      break;
    }

    // --- left ---
    default: {
      // Walking away costs nothing with the people in it - they did not see.
      // It costs with anyone who did.
      for (const witness of store.whoIsIn(incident.locationId)) {
        if (witness.id === actorId || incident.participantIds.includes(witness.id)) continue;
        store.adjustRelationship(witness.id, actorId, { respect: -4 },
          { reason: 'Walked away from it', cause: event.id });
      }
      break;
    }
  }

  store.commitReaction(reaction.id, { spawnedIncidentId: spawned?.id || null });
  return { reaction, event, spawned };
}

/**
 * Start the next link in the chain.
 *
 * `aId` is the person who just got involved and `bId` is whoever now has a
 * problem with them. The line is written from those two rather than from the
 * parent's instigator, because they are not always the same person and a
 * summary naming the wrong man is worse than no summary.
 */
function spawnFrom(parent, aId, bId, { cause }) {
  if (!bId || aId === bId) return null;
  if (parent.chainDepth + 1 >= MAX_CHAIN_DEPTH) return null;

  // A chain is a line, not a tree. One thing turns into the next thing; it does
  // not turn into four things at once, which is a riot rather than a wrestling
  // show and leaves one man in five simultaneous fights.
  if (store.incidentsCausedBy(parent.id).length) return null;

  // And nobody is in two of them. Being in an earlier link of THIS chain does
  // not count - that is the same fight - but being in an unrelated one does,
  // and that is where the chain stops.
  const mine = chainIds(parent);
  if (inAnOpenIncident(bId, mine) || inAnOpenIncident(aId, mine)) return null;

  const a = store.getWrestler(aId);
  const b = store.getWrestler(bId);
  if (!a || !b) return null;
  const summary = `${b.name} rounds on ${a.name}`;

  const child = store.raiseIncident({
    kind: INCIDENT_KINDS.FIGHT,
    locationId: parent.locationId,
    showId: parent.showId,
    segmentId: parent.segmentId,
    participantIds: [aId, bId],
    instigatorId: bId,
    targetId: aId,
    severity: Math.round(parent.severity * 0.85),
    causeIncidentId: parent.id,
    chainDepth: parent.chainDepth + 1,
    reasons: [{
      label: 'Came out of something else',
      detail: `${INCIDENT_SPECS[parent.kind].label} between ${parent.participantIds.map(store.nameOf).join(' and ')}`,
      weight: Math.round(parent.severity),
    }],
    summary,
    newsSummary: summary,
  }, { cause });

  // And the room gets to react to THAT, which is what makes it a chain.
  react(child, { cause: child.startedEventId });
  return child;
}

/** Anything whose moment has come. Called wherever the night's clock moves. */
export function flushDue({ cause = null } = {}) {
  const out = [];
  for (const reaction of store.dueReactions()) {
    const incident = store.getIncident(reaction.incidentId);
    // They get there and it is already over. Nothing to walk into, and nothing
    // anybody has to be told about - which is the cost of being two rooms away.
    if (!incident || incident.status !== INCIDENT_STATUS.OPEN) {
      store.commitReaction(reaction.id);
      continue;
    }
    const done = perform(reaction, { cause });
    if (done) out.push(done);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

export function install() {
  // Anything that goes wrong between two people, the room has an opinion about.
  store.on(EVENT_TYPES.INCIDENT_STARTED, (event) => {
    const incident = store.getIncident(event.data.incidentId);
    if (!incident || incident.reactions.length) return;
    react(incident, { cause: event.id });
  });

  // Slow burns land when the night moves on.
  store.on(EVENT_TYPES.SEGMENT_COMPLETED, (event) => flushDue({ cause: event.id }));
  store.on(EVENT_TYPES.GM_MOVED, (event) => flushDue({ cause: event.id }));

  // The show ends and whatever somebody was saving up goes unspent.
  store.on(EVENT_TYPES.SHOW_COMPLETED, () => {
    store.clearPendingReactions();
  });
}
