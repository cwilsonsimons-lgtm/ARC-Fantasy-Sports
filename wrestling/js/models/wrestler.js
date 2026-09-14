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

/**
 * Every numeric field in the model uses one of these two scales. Keeping it to
 * two means a future system never has to ask what range a field is in.
 */
export const SCALES = Object.freeze({
  UNIT: { min: 0, max: 100, neutral: 50 },     // ability, morale, trust, traits
  SIGNED: { min: -100, max: 100, neutral: 0 }, // momentum, relationships
});

export const CAREER_STATUS = Object.freeze({
  ROOKIE: 'rookie',
  JOBBER: 'jobber',
  MIDCARD: 'midcard',
  UPPER_MIDCARD: 'upper_midcard',
  MAIN_EVENT: 'main_event',
  VETERAN: 'veteran',
  DECLINING: 'declining',
});

/** Rough seniority, used for sorting and for "is this beneath me" comparisons. */
export const CAREER_RANK = Object.freeze({
  [CAREER_STATUS.ROOKIE]: 0,
  [CAREER_STATUS.JOBBER]: 1,
  [CAREER_STATUS.MIDCARD]: 2,
  [CAREER_STATUS.UPPER_MIDCARD]: 3,
  [CAREER_STATUS.MAIN_EVENT]: 4,
  [CAREER_STATUS.VETERAN]: 3,
  [CAREER_STATUS.DECLINING]: 2,
});

export const MOODS = Object.freeze([
  'content', 'confident', 'focused', 'restless', 'frustrated', 'angry', 'anxious',
]);

export const HEALTH = Object.freeze({ HEALTHY: 'healthy', INJURED: 'injured' });

export const CONTRACT_STATUS = Object.freeze({
  ACTIVE: 'active', EXPIRED: 'expired', RELEASED: 'released',
});

/**
 * Personality traits. Six, each one load-bearing for a behaviour the design
 * already describes, so the list has a reason to stop where it does:
 *   professionalism - accepts a booking they dislike anyway
 *   volatility      - the *width* of their reaction distribution
 *   loyalty         - eligibility for betrayal, and standing by an ally
 *   vindictiveness  - whether a grievance is carried or let go
 *   sociability     - how much backstage information passes through them
 *   riskAversion    - refusing a match as unnecessarily dangerous
 */
export const TRAITS = Object.freeze([
  'professionalism', 'volatility', 'loyalty', 'vindictiveness', 'sociability', 'riskAversion',
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
      traits,
    },

    // 2. Ability - slow moving.
    ability: abilities,

    // 3. Standing - public, earned, and the vocabulary of every argument.
    standing: {
      careerStatus,
      wins: standing.wins ?? 0,
      losses: standing.losses ?? 0,
      draws: standing.draws ?? 0,
      streak: standing.streak ?? { type: null, count: 0 }, // type: 'W' | 'L' | 'D'
      rank: standing.rank ?? null,        // filled by a ranking system, not yet built
      titleReigns: standing.titleReigns ?? [], // {titleId, wonOnDay, lostOnDay}
      debutDay,
    },

    // 4. State - fast moving. What the recent past did to them.
    state: {
      morale: clampUnit(state.morale ?? 60),
      momentum: clampSigned(state.momentum ?? 0),
      condition: clampUnit(state.condition ?? 100), // 100 = fresh, falls with ring time
      mood: state.mood ?? 'content',
      health: state.health ?? { status: HEALTH.HEALTHY, returnsOnDay: null },
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
export function createMemory({
  day, type, summary,
  aboutIds = [], weight = 50, floor = 5, decayPerDay = 0.5,
  sourceEventId = null, scar = false,
}) {
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

export function relationshipTo(wrestler, otherId) {
  return wrestler.ties.relationships[otherId]?.value ?? SCALES.SIGNED.neutral;
}

/** Everyone this wrestler actively likes or dislikes. Allies and enemies are
 *  read out of the relationship values, never stored as separate lists - one
 *  source of truth, so the two can never disagree. */
export function alliesOf(wrestler, threshold = 40) {
  return Object.entries(wrestler.ties.relationships)
    .filter(([, r]) => r.value >= threshold)
    .map(([id]) => id);
}

export function enemiesOf(wrestler, threshold = -40) {
  return Object.entries(wrestler.ties.relationships)
    .filter(([, r]) => r.value <= threshold)
    .map(([id]) => id);
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
