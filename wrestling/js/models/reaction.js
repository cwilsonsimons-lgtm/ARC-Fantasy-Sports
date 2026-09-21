// What somebody else does about it.
//
// A reaction is a record on an incident, not an entity of its own: it belongs
// to the thing it is a reaction to, and it only ever exists inside one. What
// makes it more than a log line is that a reaction can SPAWN a new incident,
// which then gets reactions of its own. That is the chain:
//
//   Croft jumps Vance            (incident, depth 0)
//     -> Sparrow pulls him off   (reaction: save, spawns depth 1)
//        -> Wren jumps Sparrow   (reaction: interfere, spawns depth 2)
//
// The five kinds cover both halves of the question. Three of them are somebody
// acting; two of them are somebody deciding not to, and those two matter just
// as much, because an ally who stood there and watched is a thing people
// remember.

import { mint } from '../core/ids.js';

export const REACTION_KINDS = Object.freeze({
  /** Pulled somebody out of it. */
  SAVE: 'save',
  /** Piled in on a side. */
  JOIN: 'join',
  /** Came in from outside and went after one of them. */
  INTERFERE: 'interfere',
  /** Was there, had every reason to act, and did not. */
  STOOD_BY: 'stood_by',
  /** Left rather than be anywhere near it. */
  AVOIDED: 'avoided',
});

export const REACTION_SPECS = Object.freeze({
  [REACTION_KINDS.SAVE]: {
    kind: REACTION_KINDS.SAVE,
    label: 'Save',
    acts: true,
    /** A save puts the saver in the aggressor's way, which is a new problem. */
    spawns: true,
  },
  [REACTION_KINDS.JOIN]: {
    kind: REACTION_KINDS.JOIN,
    label: 'Joined in',
    acts: true,
    spawns: false,     // it makes the same fight worse rather than a new one
  },
  [REACTION_KINDS.INTERFERE]: {
    kind: REACTION_KINDS.INTERFERE,
    label: 'Interfered',
    acts: true,
    spawns: true,
  },
  [REACTION_KINDS.STOOD_BY]: {
    kind: REACTION_KINDS.STOOD_BY,
    label: 'Stood there',
    acts: false,
    spawns: false,
  },
  [REACTION_KINDS.AVOIDED]: {
    kind: REACTION_KINDS.AVOIDED,
    label: 'Walked away',
    acts: false,
    spawns: false,
  },
});

export const REACTION_KEYS = Object.freeze(Object.keys(REACTION_SPECS));

export function reactionSpec(kind) {
  const spec = REACTION_SPECS[kind];
  if (!spec) throw new Error(`Unknown reaction "${kind}". Add it to REACTION_SPECS.`);
  return spec;
}

export function isKnownReactionKind(kind) {
  return kind in REACTION_SPECS;
}

/** Why somebody got involved. A closed vocabulary, like memory types. */
export const MOTIVES = Object.freeze({
  ALLY: 'ally',
  FACTION: 'faction',
  CODE: 'code',              // babyfaces help babyfaces
  RIVALRY: 'rivalry',
  GRUDGE: 'grudge',
  JEALOUSY: 'jealousy',
  LOYALTY: 'loyalty',
});

export const MOTIVE_LABEL = Object.freeze({
  [MOTIVES.ALLY]: 'They are close',
  [MOTIVES.FACTION]: 'Same stable',
  [MOTIVES.CODE]: 'One babyface helping another',
  [MOTIVES.RIVALRY]: 'Heat between them',
  [MOTIVES.GRUDGE]: 'Has not forgotten',
  [MOTIVES.JEALOUSY]: 'Resents them',
  [MOTIVES.LOYALTY]: 'The sort who gets involved',
});

export function createReaction(spec = {}) {
  const {
    id = mint('reaction'),
    incidentId,
    wrestlerId,
    kind,
    /** Who they acted for (a save or a join) or against (an interference). */
    forId = null,
    againstId = null,
    score = 0,
    nerve = 0,
    reasons = [],
    raisedTick = 0,
    dueTick = 0,
    tick = null,          // when it actually happened, once it has
    spawnedIncidentId = null,
  } = spec;

  reactionSpec(kind);
  if (!incidentId) throw new Error('createReaction: a reaction is a reaction to something');
  if (!wrestlerId) throw new Error('createReaction: somebody has to be reacting');

  return {
    id, incidentId, wrestlerId, kind,
    forId, againstId,
    score,              // how strongly they were pulled in
    nerve,              // whether they had it in them
    reasons,            // [{motive, label, detail, weight}]
    raisedTick,         // when the thing they are reacting to happened
    dueTick,            // when they act. Later than raisedTick is a slow burn.
    tick,
    spawnedIncidentId,
  };
}

/** Acted on the night rather than only having an opinion about it. */
export function didSomething(reaction) {
  return reactionSpec(reaction.kind).acts;
}

export function isDelayed(reaction) {
  return reaction.dueTick > reaction.raisedTick;
}

export function validateReaction(r) {
  const problems = [];
  if (!isKnownReactionKind(r.kind)) problems.push(`unknown kind "${r.kind}"`);
  if (!r.wrestlerId) problems.push('nobody is reacting');
  if (!Number.isFinite(r.dueTick)) problems.push('dueTick is not a number');
  if (Number.isFinite(r.raisedTick) && Number.isFinite(r.dueTick) && r.dueTick < r.raisedTick) {
    problems.push('reacted before it happened');
  }
  for (const reason of r.reasons || []) {
    if (reason.motive && !(reason.motive in MOTIVE_LABEL)) {
      problems.push(`unknown motive "${reason.motive}"`);
    }
  }
  return problems;
}
