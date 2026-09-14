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
import { WRESTLER_SHAPE_KEYS, validateWrestler } from '../models/wrestler.js';

/** Containers that are allowed to hold whole entities. */
const ENTITY_REGISTRIES = ['wrestlers', 'shows', 'segments'];

export function checkState(state) {
  const problems = [];
  if (!state || typeof state !== 'object') return ['state is not an object'];

  for (const key of ['meta', 'calendar', 'wrestlers', 'shows', 'segments', 'log']) {
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
  for (const w of Object.values(state.wrestlers)) {
    for (const p of validateWrestler(w)) problems.push(`wrestler ${w.id}: ${p}`);
  }

  const wrestlerIds = new Set(Object.keys(state.wrestlers));
  const showIds = new Set(Object.keys(state.shows));
  const segmentIds = new Set(Object.keys(state.segments));

  const refMustExist = (id, set, where) => {
    if (id != null && !set.has(id)) problems.push(`${where} points at missing ${typeOf(id) || 'entity'} "${id}"`);
  };

  // --- every cross-system reference resolves ---
  for (const w of Object.values(state.wrestlers)) {
    for (const otherId of Object.keys(w.ties.relationships)) {
      refMustExist(otherId, wrestlerIds, `wrestler ${w.id} relationship`);
      if (otherId === w.id) problems.push(`wrestler ${w.id} holds a relationship with themselves`);
    }
    for (const m of w.memory) {
      for (const about of m.aboutIds) {
        if (typeOf(about) === 'wrestler') refMustExist(about, wrestlerIds, `memory ${m.id}`);
      }
    }
  }

  for (const show of Object.values(state.shows)) {
    for (const sid of show.segmentIds) refMustExist(sid, segmentIds, `show ${show.id} card`);
  }

  for (const seg of Object.values(state.segments)) {
    refMustExist(seg.showId, showIds, `segment ${seg.id}`);
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
