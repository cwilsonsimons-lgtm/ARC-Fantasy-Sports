// The wrestler model.
//
// One wrestler is one object in `state.wrestlers`, addressed by its ID from
// everywhere else in the game. Nothing outside this registry ever holds a copy
// of a wrestler: a match holds `wrestlerId`, a memory holds `aboutIds`, a
// relationship is keyed by the other wrestler's ID. invariants.js enforces this.
//
// The six layers below are the ones set out in the design foundation. They are
// grouped rather than flat because each layer changes on a different timescale,
// and the systems that read them care about different ones:
//
//   identity  - never changes;      the lens everything is interpreted through
//   ability   - changes over years;  what they can actually do in a ring
//   standing  - changes every show;  the public record, and what arguments cite
//   state     - changes hourly;      what the recent past did to them
//   ties      - changes on events;   who they like, and what they think of you
//   memory    - accumulates;         the receipts, and the reason for behaviour

import { mint } from '../core/ids.js';
import {
  createRelationship, describe as describeRelationship,
  isAlly, isEnemy, isRival, isNotable, AXIS_RANGE,
} from './relationship.js';
import { memorySpec } from './memory.js';

/**
 * Every numeric field in the model uses one of these two scales. Keeping it to
 * two means a future system never has to ask what range a field is in.
 */
export const SCALES = Object.freeze({
  UNIT: { min: 0, max: 100, neutral: 50 },     // ability, morale, trust, traits
  SIGNED: { min: -100, max: 100, neutral: 0 }, // momentum, relationships
});

/**
 * Where a wrestler sits on the card. Seven rungs, low to high.
 *
 * This is position, not trajectory - a faded former main-eventer working the
 * lower card and a kid climbing toward it occupy the same rung and behave
 * nothing alike, which is what `trajectory` below is for.
 *
 * Status is the single most important input to whether a behaviour is
 * believable. A rookie does not have the standing to refuse anything; a
 * superstar has enough standing to refuse almost everything.
 */
export const CAREER_STATUS = Object.freeze({
  ROOKIE: 'rookie',
  JOBBER: 'jobber',
  LOWER_CARD: 'lower_card',
  MIDCARD: 'midcard',
  UPPER_MIDCARD: 'upper_midcard',
  MAIN_EVENT: 'main_event',
  SUPERSTAR: 'superstar',
});

/** Position on the card, 0 (rookie) to 6 (superstar). */
export const CAREER_RANK = Object.freeze({
  [CAREER_STATUS.ROOKIE]: 0,
  [CAREER_STATUS.JOBBER]: 1,
  [CAREER_STATUS.LOWER_CARD]: 2,
  [CAREER_STATUS.MIDCARD]: 3,
  [CAREER_STATUS.UPPER_MIDCARD]: 4,
  [CAREER_STATUS.MAIN_EVENT]: 5,
  [CAREER_STATUS.SUPERSTAR]: 6,
});

export const CAREER_ORDER = Object.freeze([
  CAREER_STATUS.ROOKIE, CAREER_STATUS.JOBBER, CAREER_STATUS.LOWER_CARD,
  CAREER_STATUS.MIDCARD, CAREER_STATUS.UPPER_MIDCARD, CAREER_STATUS.MAIN_EVENT,
  CAREER_STATUS.SUPERSTAR,
]);

export const TOP_STATUS_RANK = CAREER_RANK[CAREER_STATUS.SUPERSTAR];

/**
 * Which way they are heading. Separate from status because the two say
 * different things: a rising midcarder takes a loss as a setback on the way up,
 * a declining one takes the same loss as proof it is over.
 */
export const TRAJECTORY = Object.freeze({
  RISING: 'rising',
  STEADY: 'steady',
  DECLINING: 'declining',
});

export const MOODS = Object.freeze([
  'content', 'confident', 'focused', 'restless', 'frustrated', 'angry', 'anxious',
]);

export const HEALTH = Object.freeze({ HEALTHY: 'healthy', INJURED: 'injured' });

/**
 * Which way the crowd is meant to take them.
 *
 * Authored character, like position on the card: it is who somebody is, not
 * something that has happened to them, so a blank-slate save still has it. It
 * earns its place in exactly one rule - babyfaces help babyfaces - and nothing
 * else reads it, because an alignment that silently changed every number would
 * be a second personality system wearing a hat.
 */
export const ALIGNMENT = Object.freeze({
  FACE: 'face',
  HEEL: 'heel',
  TWEENER: 'tweener',
});

export const ALIGNMENT_LABEL = Object.freeze({
  [ALIGNMENT.FACE]: 'Babyface',
  [ALIGNMENT.HEEL]: 'Heel',
  [ALIGNMENT.TWEENER]: 'Tweener',
});

export const CONTRACT_STATUS = Object.freeze({
  ACTIVE: 'active', EXPIRED: 'expired', RELEASED: 'released',
});

/**
 * Personality traits, all 0-100.
 *
 * Every one earns its place by changing a specific behaviour. Ego and ambition
 * are NOT in here: they sit alongside traits on `identity` because they are
 * what a wrestler wants rather than how they are, and almost everything else
 * gets weighed against them.
 *
 *   How they treat the job
 *     professionalism    - accepts a booking they dislike anyway
 *     respectForAuthority- defers to the office even when they disagree
 *     patience           - how long they will wait for what they were promised
 *
 *   How they treat people
 *     loyalty            - stands by an ally; eligibility for betrayal
 *     jealousy           - resents someone else's spot as taken from them
 *     vindictiveness     - carries a grievance rather than letting it go
 *     aggression         - escalates rather than swallowing it
 *
 *   How they treat risk
 *     courage            - takes the dangerous match, the high spot, the fall
 *
 *   How predictable they are
 *     volatility         - the WIDTH of their reaction range, not its centre
 *     sociability        - how much backstage information passes through them
 */
export const TRAITS = Object.freeze([
  'professionalism', 'respectForAuthority', 'patience',
  'loyalty', 'jealousy', 'vindictiveness', 'aggression',
  'courage',
  'volatility', 'sociability',
]);

/** Grouping, for anything that wants to show them in readable blocks. */
export const TRAIT_GROUPS = Object.freeze([
  { label: 'The job', traits: ['professionalism', 'respectForAuthority', 'patience'] },
  { label: 'People', traits: ['loyalty', 'jealousy', 'vindictiveness', 'aggression'] },
  { label: 'Risk', traits: ['courage'] },
  { label: 'Temperament', traits: ['volatility', 'sociability'] },
]);

/** The four performance stats. Deliberately small; resist growing this. */
export const ABILITIES = Object.freeze(['workRate', 'charisma', 'durability', 'starPower']);

export function clampUnit(n) {
  return Math.max(SCALES.UNIT.min, Math.min(SCALES.UNIT.max, Math.round(n)));
}

export function clampSigned(n) {
  return Math.max(SCALES.SIGNED.min, Math.min(SCALES.SIGNED.max, Math.round(n)));
}

/**
 * Build a wrestler. Everything has a neutral default so a partial spec is legal,
 * which is what makes the hand-authored roster readable.
 */
export function createWrestler(spec = {}) {
  const {
    id = mint('wrestler'),
    name,
    shortName,
    debutDay = 0,
    careerStatus = CAREER_STATUS.MIDCARD,
    trajectory = TRAJECTORY.STEADY,
    identity = {},
    ability = {},
    standing = {},
    state = {},
    ties = {},
    contract = {},
    memory = [],
  } = spec;

  if (!name) throw new Error('createWrestler: name is required');

  const traits = {};
  for (const t of TRAITS) traits[t] = clampUnit(identity.traits?.[t] ?? SCALES.UNIT.neutral);

  const abilities = {};
  for (const a of ABILITIES) abilities[a] = clampUnit(ability[a] ?? SCALES.UNIT.neutral);

  return {
    id,
    name,
    shortName: shortName || name.split(' ').slice(-1)[0],
    createdDay: debutDay,
    brandId: null, // reserved: competing brands are an optional mode, not built

    // 1. Identity - stable. The lens.
    identity: {
      ego: clampUnit(identity.ego ?? SCALES.UNIT.neutral),
      ambition: clampUnit(identity.ambition ?? SCALES.UNIT.neutral),
      alignment: identity.alignment ?? ALIGNMENT.TWEENER,
      traits,
    },

    // 2. Ability - slow moving.
    ability: abilities,

    // 3. Standing - public, earned, and the vocabulary of every argument.
    standing: {
      careerStatus,
      trajectory,
      wins: standing.wins ?? 0,
      losses: standing.losses ?? 0,
      draws: standing.draws ?? 0,
      streak: standing.streak ?? { type: null, count: 0 }, // type: 'W' | 'L' | 'D'
      // Rank is recomputed from results by systems/rankings.js. `rankPoints` is
      // kept alongside it so the UI can show WHY somebody is ranked where they
      // are - a wrestler is going to quote this number at the GM.
      rank: standing.rank ?? null,
      rankPoints: standing.rankPoints ?? 0,
      debutDay,
      // Title reigns are NOT stored here. A reign lives once, in the title's
      // lineage, and is read back with reignsOf(). Storing it on the wrestler
      // too would be a second copy of the same fact, free to disagree.
    },

    // 4. State - fast moving. What the recent past did to them.
    state: {
      morale: clampUnit(state.morale ?? 60),
      momentum: clampSigned(state.momentum ?? 0),
      condition: clampUnit(state.condition ?? 100), // 100 = fresh, falls with ring time
      mood: state.mood ?? 'content',
      health: state.health ?? { status: HEALTH.HEALTHY, returnsOnDay: null },
      // What the office has had to do about them. Separate from health,
      // because being unable to work and being not allowed to are different
      // things and the roster feels them differently.
      discipline: state.discipline ?? {
        warnings: 0,
        suspendedUntilDay: null,
        sentHomeFromShowId: null,
      },
    },

    // 5. Ties.
    //
    // Relationships are DIRECTED: `relationships[otherId]` is how *this*
    // wrestler feels about that one, which need not be mutual. That is the
    // point - the design's example has B taking exception to something A did
    // while A thinks nothing of it, and a symmetric value cannot express that.
    ties: {
      relationships: ties.relationships ?? {}, // otherId -> {value, lastChangedDay, sourceEventIds}
      gm: {
        trust: clampUnit(ties.gm?.trust ?? 50),    // do they believe what you say
        respect: clampUnit(ties.gm?.respect ?? 50), // do they rate you as a GM
      },
    },

    // 6. Memory - the engine. Why they behave the way they do, and what they
    // quote at you when they push back.
    memory,

    // Contract. The *system* is not built; the fields live here so that when it
    // is, it extends this entity instead of starting a parallel roster.
    contract: {
      salary: contract.salary ?? 0,
      signedOnDay: contract.signedOnDay ?? debutDay,
      expiresOnDay: contract.expiresOnDay ?? null,
      status: contract.status ?? CONTRACT_STATUS.ACTIVE,
    },
  };
}

// --- memory ----------------------------------------------------------------

/**
 * A remembered event.
 *
 * `weight` is how much it still matters today; it decays toward `floor` at
 * `decayPerDay`. A scar is simply a memory with a high floor, which is how
 * "memory decays but never vanishes, and large events scar permanently" becomes
 * one number rather than a special case.
 */
export function createMemory(spec) {
  const {
    day, type, summary,
    aboutIds = [], weight = 50, floor = 5, decayPerDay = 0.5,
    sourceEventId = null, scar = false,
  } = spec.type ? memorySpec(spec.type, spec) : spec;
  return {
    id: mint('memory'),
    day,
    type,
    summary,
    aboutIds,
    weight: clampUnit(weight),
    floor: clampUnit(scar ? Math.max(floor, 40) : floor),
    decayPerDay,
    scar,
    sourceEventId,
  };
}

/** How much a memory still weighs today. Pure - never mutates the memory. */
export function memoryWeightOn(memory, today) {
  const elapsed = Math.max(0, today - memory.day);
  return Math.max(memory.floor, memory.weight - memory.decayPerDay * elapsed);
}

/** Live memories about a given entity, heaviest first. */
export function memoriesAbout(wrestler, entityId, today) {
  return wrestler.memory
    .filter((m) => m.aboutIds.includes(entityId))
    .map((m) => ({ memory: m, weight: memoryWeightOn(m, today) }))
    .sort((a, b) => b.weight - a.weight);
}

// --- derived reads ---------------------------------------------------------

export function recordOf(wrestler) {
  const { wins, losses, draws } = wrestler.standing;
  return draws ? `${wins}-${losses}-${draws}` : `${wins}-${losses}`;
}

export function streakLabel(wrestler) {
  const { type, count } = wrestler.standing.streak;
  if (!type || !count) return 'none';
  return `${type}${count}`;
}

export function isAvailable(wrestler, day) {
  const h = wrestler.state.health;
  if (h.status === HEALTH.HEALTHY) return true;
  return h.returnsOnDay != null && day >= h.returnsOnDay;
}

/**
 * Suspended is not injured. A suspended wrestler is perfectly fit and simply
 * not allowed on television, which is why booking checks it separately and the
 * roster screen says something different about it.
 */
export function isSuspended(wrestler, day) {
  const until = wrestler.state.discipline?.suspendedUntilDay;
  return until != null && day < until;
}

/** Fit, and allowed. What booking actually needs to know. */
export function canBeBooked(wrestler, day) {
  return isAvailable(wrestler, day) && !isSuspended(wrestler, day);
}

export function isFace(wrestler) {
  return wrestler.identity.alignment === ALIGNMENT.FACE;
}

/** Position on the card as a number, for "is this beneath me" comparisons. */
export function statusRank(wrestler) {
  return CAREER_RANK[wrestler.standing.careerStatus] ?? 3;
}

/**
 * How much standing this wrestler has to push back with, 0 to 1.
 *
 * This is the number that makes the tier's central rule true: a rookie jobber
 * rarely refuses because refusing is not available to someone with no standing,
 * whatever their ego says. A superstar has all of it.
 */
export function standingWeight(wrestler) {
  return statusRank(wrestler) / TOP_STATUS_RANK;
}

/** The whole four-axis view, or a neutral one if they have no opinion yet. */
export function relationshipWith(wrestler, otherId) {
  return wrestler.ties.relationships[otherId] || createRelationship({}, wrestler.createdDay);
}

/** The ally rating. Kept as the plain name because it is the axis most callers want. */
export function relationshipTo(wrestler, otherId) {
  return relationshipWith(wrestler, otherId).affinity;
}

export function hostilityTo(wrestler, otherId) { return relationshipWith(wrestler, otherId).hostility; }
export function respectTo(wrestler, otherId) { return relationshipWith(wrestler, otherId).respect; }
export function trustTo(wrestler, otherId) { return relationshipWith(wrestler, otherId).trust; }

/**
 * Allies, enemies and rivals are READ from the relationship axes, never stored
 * as separate lists. One source of truth, so the list and the numbers can never
 * disagree.
 */
export function alliesOf(wrestler) {
  return Object.entries(wrestler.ties.relationships).filter(([, r]) => isAlly(r)).map(([id]) => id);
}

export function enemiesOf(wrestler) {
  return Object.entries(wrestler.ties.relationships).filter(([, r]) => isEnemy(r)).map(([id]) => id);
}

/** Heat, which does not require dislike. This is where feuds come from. */
export function rivalsOf(wrestler) {
  return Object.entries(wrestler.ties.relationships).filter(([, r]) => isRival(r)).map(([id]) => id);
}

/** Everyone they have any opinion about at all, strongest feeling first. */
export function notableTies(wrestler) {
  return Object.entries(wrestler.ties.relationships)
    .filter(([, r]) => isNotable(r))
    .sort((a, b) => (Math.abs(b[1].affinity) + b[1].hostility) - (Math.abs(a[1].affinity) + a[1].hostility))
    .map(([id, rel]) => ({ id, rel, label: describeRelationship(rel) }));
}

/** Structural check used by invariants.js and by save loading. */
export function validateWrestler(w) {
  const problems = [];
  if (!w || typeof w !== 'object') return ['not an object'];
  if (!w.id) problems.push('missing id');
  if (!w.name) problems.push('missing name');
  for (const layer of ['identity', 'ability', 'standing', 'state', 'ties', 'contract']) {
    if (!w[layer] || typeof w[layer] !== 'object') problems.push(`missing layer "${layer}"`);
  }
  if (!Array.isArray(w.memory)) problems.push('memory is not an array');
  for (const a of ABILITIES) {
    const v = w.ability?.[a];
    if (!Number.isFinite(v)) problems.push(`ability.${a} is not a number`);
  }
  return problems;
}

/**
 * The keys that identify an object as wrestler-shaped. invariants.js uses this
 * to detect a second copy of a wrestler embedded somewhere it should not be.
 */
export const WRESTLER_SHAPE_KEYS = Object.freeze(['identity', 'ability', 'standing', 'ties']);
