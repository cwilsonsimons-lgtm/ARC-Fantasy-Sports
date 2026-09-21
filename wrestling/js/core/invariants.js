// Integrity checks over the whole state.
//
// The rule this file exists to enforce: there is exactly ONE copy of each
// wrestler, living in `state.wrestlers`, and everything else refers to it by ID.
// The moment a system stores its own copy - a roster screen caching a wrestler,
// a match embedding its competitors - the two drift, and a bug appears where a
// wrestler is angry in one screen and content in another.
//
// `checkState` runs on every save load, and can be run at any time from the
// console. It is cheap enough to run after every action while developing.

import { typeOf } from './ids.js';
import { WRESTLER_SHAPE_KEYS, validateWrestler, CAREER_STATUS, TRAJECTORY, TRAITS, ALIGNMENT } from '../models/wrestler.js';
import { validateRelationship } from '../models/relationship.js';
import { isKnownMemoryType } from '../models/memory.js';
import { validateRequest } from '../models/request.js';
import { isLocation, locationName } from '../models/location.js';
import { validateNotification } from '../models/notification.js';
import { validateIncident, INCIDENT_STATUS } from '../models/incident.js';
import { validateFaction } from '../models/faction.js';
import { validateReaction } from '../models/reaction.js';

/** Containers that are allowed to hold whole entities. */
const ENTITY_REGISTRIES = ['wrestlers', 'shows', 'segments', 'titles', 'requests', 'incidents', 'factions'];

export function checkState(state) {
  const problems = [];
  if (!state || typeof state !== 'object') return ['state is not an object'];

  for (const key of ['meta', 'calendar', 'wrestlers', 'shows', 'segments', 'titles', 'requests', 'incidents', 'factions', 'backstage', 'log']) {
    if (state[key] == null) problems.push(`state.${key} is missing`);
  }
  if (problems.length) return problems;

  // --- registries are keyed by their own IDs ---
  for (const registry of ENTITY_REGISTRIES) {
    for (const [key, entity] of Object.entries(state[registry])) {
      if (entity.id !== key) {
        problems.push(`${registry}["${key}"] has id "${entity.id}" - key and id disagree`);
      }
    }
  }

  // --- wrestlers are structurally sound ---
  const STATUSES = new Set(Object.values(CAREER_STATUS));
  const TRAJECTORIES = new Set(Object.values(TRAJECTORY));
  for (const w of Object.values(state.wrestlers)) {
    for (const p of validateWrestler(w)) problems.push(`wrestler ${w.id}: ${p}`);
    if (!STATUSES.has(w.standing.careerStatus)) {
      problems.push(`wrestler ${w.id} has unknown career status "${w.standing.careerStatus}"`);
    }
    if (!TRAJECTORIES.has(w.standing.trajectory)) {
      problems.push(`wrestler ${w.id} has unknown trajectory "${w.standing.trajectory}"`);
    }
    for (const trait of TRAITS) {
      if (!Number.isFinite(w.identity.traits?.[trait])) {
        problems.push(`wrestler ${w.id} is missing the "${trait}" trait`);
      }
    }
  }

  const wrestlerIds = new Set(Object.keys(state.wrestlers));
  const showIds = new Set(Object.keys(state.shows));
  const segmentIds = new Set(Object.keys(state.segments));
  const titleIds = new Set(Object.keys(state.titles));

  const refMustExist = (id, set, where) => {
    if (id != null && !set.has(id)) problems.push(`${where} points at missing ${typeOf(id) || 'entity'} "${id}"`);
  };

  // --- every cross-system reference resolves ---
  for (const w of Object.values(state.wrestlers)) {
    for (const [otherId, rel] of Object.entries(w.ties.relationships)) {
      refMustExist(otherId, wrestlerIds, `wrestler ${w.id} relationship`);
      if (otherId === w.id) problems.push(`wrestler ${w.id} holds a relationship with themselves`);
      for (const p of validateRelationship(rel)) {
        problems.push(`wrestler ${w.id} relationship with ${otherId}: ${p}`);
      }
    }
    for (const m of w.memory) {
      for (const about of m.aboutIds) {
        if (typeOf(about) === 'wrestler') refMustExist(about, wrestlerIds, `memory ${m.id}`);
      }
      if (!isKnownMemoryType(m.type)) {
        problems.push(`wrestler ${w.id} memory ${m.id} has unknown type "${m.type}"`);
      }
    }
  }

  for (const show of Object.values(state.shows)) {
    for (const sid of show.segmentIds) refMustExist(sid, segmentIds, `show ${show.id} card`);
  }

  for (const seg of Object.values(state.segments)) {
    refMustExist(seg.showId, showIds, `segment ${seg.id}`);
    if (seg.titleId) refMustExist(seg.titleId, titleIds, `segment ${seg.id} title`);
    for (const p of seg.participants) {
      refMustExist(p.wrestlerId, wrestlerIds, `segment ${seg.id} participant`);
    }
    for (const id of [...(seg.result.winnerIds || []), ...(seg.result.loserIds || [])]) {
      refMustExist(id, wrestlerIds, `segment ${seg.id} result`);
    }
    // A segment on a show's card must be listed by that show, and only that show.
    const owner = state.shows[seg.showId];
    if (owner && seg.status !== 'cut' && !owner.segmentIds.includes(seg.id)) {
      problems.push(`segment ${seg.id} claims show ${seg.showId} but is not on its card`);
    }
  }

  for (const entry of state.calendar.entries) {
    refMustExist(entry.showId, showIds, `calendar entry ${entry.id}`);
  }

  // --- a title's lineage is one continuous chain with at most one open link ---
  for (const title of Object.values(state.titles)) {
    if (title.contenderId) refMustExist(title.contenderId, wrestlerIds, `${title.id} contender`);
    let open = 0;
    title.lineage.forEach((reign, i) => {
      for (const id of reign.wrestlerIds) refMustExist(id, wrestlerIds, `${title.id} reign ${i}`);
      for (const id of reign.wonFromIds) refMustExist(id, wrestlerIds, `${title.id} reign ${i} lost by`);
      if (reign.atShowId) refMustExist(reign.atShowId, showIds, `${title.id} reign ${i}`);
      if (reign.atSegmentId) refMustExist(reign.atSegmentId, segmentIds, `${title.id} reign ${i}`);
      if (reign.lostOnDay == null) {
        open++;
        if (i !== title.lineage.length - 1) {
          problems.push(`${title.id} reign ${i} never ended but is not the current one`);
        }
      } else if (reign.lostOnDay < reign.wonOnDay) {
        problems.push(`${title.id} reign ${i} was lost before it was won`);
      }
      if (i > 0) {
        const prev = title.lineage[i - 1];
        if (prev.lostOnDay != null && reign.wonOnDay < prev.lostOnDay) {
          problems.push(`${title.id} reign ${i} starts before reign ${i - 1} ended`);
        }
      }
      if (!reign.wrestlerIds.length) problems.push(`${title.id} reign ${i} has no champion`);
    });
    if (open > 1) problems.push(`${title.id} has ${open} champions at once`);
  }

  // --- a wrestler's reigns live only in the lineage ---
  for (const w of Object.values(state.wrestlers)) {
    if (w.standing.titleReigns !== undefined) {
      problems.push(`wrestler ${w.id} carries its own titleReigns - reigns live in the title's lineage`);
    }
  }

  // --- the log is append-only and internally consistent ---
  const seenEventIds = new Set();
  state.log.forEach((e, i) => {
    if (e.seq !== i + 1) problems.push(`log[${i}] has seq ${e.seq}, expected ${i + 1}`);
    if (seenEventIds.has(e.id)) problems.push(`duplicate event id ${e.id}`);
    seenEventIds.add(e.id);
    if (i > 0 && e.day < state.log[i - 1].day) {
      problems.push(`log[${i}] (${e.id}) goes back in time`);
    }
    for (const s of e.subjects) {
      if (typeOf(s) === 'wrestler') refMustExist(s, wrestlerIds, `event ${e.id} subject`);
    }
    if (e.causeId && !seenEventIds.has(e.causeId)) {
      problems.push(`event ${e.id} cites cause ${e.causeId}, which does not precede it`);
    }
  });

  // --- requests point at real people and say why they exist ---
  for (const r of Object.values(state.requests)) {
    refMustExist(r.wrestlerId, wrestlerIds, `request ${r.id}`);
    if (r.targetId) refMustExist(r.targetId, wrestlerIds, `request ${r.id} target`);
    if (r.titleId) refMustExist(r.titleId, titleIds, `request ${r.id} title`);
    if (r.resolvedBySegmentId) refMustExist(r.resolvedBySegmentId, segmentIds, `request ${r.id}`);
    for (const p of validateRequest(r)) problems.push(`request ${r.id}: ${p}`);
  }

  // --- incidents happened to real people, in a real room ---
  const incidentIds = new Set(Object.keys(state.incidents));
  const alignments = new Set(Object.values(ALIGNMENT));
  for (const w of Object.values(state.wrestlers)) {
    if (!alignments.has(w.identity.alignment)) {
      problems.push(`wrestler ${w.id} has unknown alignment "${w.identity.alignment}"`);
    }
  }
  for (const inc of Object.values(state.incidents)) {
    for (const p of validateIncident(inc)) problems.push(`incident ${inc.id}: ${p}`);
    if (!isLocation(inc.locationId)) {
      problems.push(`incident ${inc.id} happened in unknown location "${inc.locationId}"`);
    }
    for (const id of inc.participantIds) refMustExist(id, wrestlerIds, `incident ${inc.id}`);
    if (inc.targetId) refMustExist(inc.targetId, wrestlerIds, `incident ${inc.id} target`);
    if (inc.instigatorId) refMustExist(inc.instigatorId, wrestlerIds, `incident ${inc.id} instigator`);
    if (inc.showId) refMustExist(inc.showId, showIds, `incident ${inc.id}`);
    if (inc.segmentId) refMustExist(inc.segmentId, segmentIds, `incident ${inc.id}`);
    if (inc.blocksSegmentId) refMustExist(inc.blocksSegmentId, segmentIds, `incident ${inc.id} block`);
    if (inc.startedEventId && !state.log.some((e) => e.id === inc.startedEventId)) {
      problems.push(`incident ${inc.id} cites missing event "${inc.startedEventId}"`);
    }
    // An incident the GM was never told about cannot have been answered.
    if (inc.response && inc.discoveredTick == null) {
      problems.push(`incident ${inc.id} was answered without ever reaching the GM`);
    }
    // A chain has to terminate and cannot loop.
    if (inc.causeIncidentId) {
      refMustExist(inc.causeIncidentId, incidentIds, `incident ${inc.id} chain`);
      const parent = state.incidents[inc.causeIncidentId];
      if (parent && parent.chainDepth >= inc.chainDepth) {
        problems.push(`incident ${inc.id} is at depth ${inc.chainDepth} under a parent at ${parent.chainDepth}`);
      }
    } else if (inc.chainDepth !== 0) {
      problems.push(`incident ${inc.id} has no cause but sits at depth ${inc.chainDepth}`);
    }

    // --- reactions belong to real people and cannot predate what they answer ---
    for (const r of inc.reactions || []) {
      for (const p of validateReaction(r)) problems.push(`reaction ${r.id}: ${p}`);
      if (r.incidentId !== inc.id) {
        problems.push(`reaction ${r.id} is filed under ${inc.id} but claims ${r.incidentId}`);
      }
      refMustExist(r.wrestlerId, wrestlerIds, `reaction ${r.id}`);
      if (r.forId) refMustExist(r.forId, wrestlerIds, `reaction ${r.id} for`);
      if (r.againstId) refMustExist(r.againstId, wrestlerIds, `reaction ${r.id} against`);
      if (r.spawnedIncidentId) refMustExist(r.spawnedIncidentId, incidentIds, `reaction ${r.id} spawn`);
      if (inc.participantIds.includes(r.wrestlerId) && r.kind !== 'join') {
        problems.push(`reaction ${r.id}: ${r.wrestlerId} is reacting to something they are in`);
      }
    }
  }

  // --- a faction is a real group of real people, and nobody is in two ---
  const inAFaction = new Set();
  for (const f of Object.values(state.factions)) {
    for (const p of validateFaction(f)) problems.push(`faction ${f.id}: ${p}`);
    for (const id of f.memberIds) {
      refMustExist(id, wrestlerIds, `faction ${f.id}`);
      if (f.disbandedOnDay != null) continue;
      if (inAFaction.has(id)) problems.push(`${id} is in more than one faction`);
      inAFaction.add(id);
    }
  }

  // --- everything queued to happen still has something to happen to ---
  const reactionIds = new Set(
    Object.values(state.incidents).flatMap((i) => (i.reactions || []).map((r) => r.id))
  );
  for (const id of state.pendingReactions || []) {
    if (!reactionIds.has(id)) problems.push(`pending reaction ${id} does not exist`);
  }

  // --- a blocked segment is blocked by an incident that is still open ---
  for (const seg of Object.values(state.segments)) {
    const blocker = seg.blockedByIncidentId;
    if (!blocker) continue;
    refMustExist(blocker, incidentIds, `segment ${seg.id} block`);
    const inc = state.incidents[blocker];
    if (inc && inc.status !== INCIDENT_STATUS.OPEN) {
      problems.push(`segment ${seg.id} is held up by ${blocker}, which is already ${inc.status}`);
    }
  }

  // --- everybody is somewhere real, and the GM is too ---
  const b = state.backstage;
  if (!isLocation(b.gmLocation)) problems.push(`the GM is in unknown location "${b.gmLocation}"`);
  if (!Number.isFinite(b.tick) || b.tick < 0) problems.push(`backstage clock is ${b.tick}`);
  for (const [id, locationId] of Object.entries(b.wrestlers)) {
    refMustExist(id, wrestlerIds, 'backstage placement');
    if (!isLocation(locationId)) {
      problems.push(`wrestler ${id} is in unknown location "${locationId}"`);
    }
  }
  for (const w of Object.values(state.wrestlers)) {
    if (!b.wrestlers[w.id]) problems.push(`wrestler ${w.id} is not anywhere in the building`);
  }

  // --- news is about real people and cannot arrive before it happened ---
  const eventIds = new Set(state.log.map((e) => e.id));
  for (const n of b.notifications) {
    for (const p of validateNotification(n)) problems.push(`notification ${n.id}: ${p}`);
    if (n.locationId && !isLocation(n.locationId)) {
      problems.push(`notification ${n.id} points at unknown location "${n.locationId}"`);
    }
    if (n.eventId && !eventIds.has(n.eventId)) {
      problems.push(`notification ${n.id} cites missing event "${n.eventId}"`);
    }
    if (n.sourceWrestlerId) refMustExist(n.sourceWrestlerId, wrestlerIds, `notification ${n.id} source`);
    for (const id of n.aboutIds) {
      if (typeOf(id) === 'wrestler') refMustExist(id, wrestlerIds, `notification ${n.id}`);
    }
  }

  // --- a located event points at a real room ---
  for (const e of state.log) {
    if (e.locationId && !isLocation(e.locationId)) {
      problems.push(`event ${e.id} happened in unknown location "${e.locationId}"`);
    }
  }

  problems.push(...findDuplicateWrestlers(state));
  return problems;
}

/**
 * Walk everything except the wrestler registry looking for wrestler-shaped
 * objects. A hit means some system stored a whole wrestler where it should have
 * stored an ID, which is the failure mode this architecture exists to prevent.
 */
export function findDuplicateWrestlers(state) {
  const problems = [];
  const seen = new WeakSet();

  const isWrestlerShaped = (v) =>
    v && typeof v === 'object' && !Array.isArray(v)
    && WRESTLER_SHAPE_KEYS.every((k) => k in v);

  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach((v, i) => {
        if (isWrestlerShaped(v)) {
          problems.push(`duplicate wrestler data at ${path}[${i}] - store the wrestler id instead`);
        } else walk(v, `${path}[${i}]`);
      });
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (isWrestlerShaped(v)) {
        problems.push(`duplicate wrestler data at ${path}.${k} - store the wrestler id instead`);
      } else walk(v, `${path}.${k}`);
    }
  };

  for (const [key, value] of Object.entries(state)) {
    if (key === 'wrestlers') continue; // the one legitimate home
    walk(value, `state.${key}`);
  }
  return problems;
}

/** Throw if the state is not sound. For use during development. */
export function assertSound(state) {
  const problems = checkState(state);
  if (problems.length) throw new Error(`State integrity failed:\n- ${problems.join('\n- ')}`);
  return true;
}
