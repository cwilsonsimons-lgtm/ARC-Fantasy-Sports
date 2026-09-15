// What one wrestler thinks of another.
//
// Four axes, not one number, because one number cannot say the things that
// matter most in wrestling:
//
//   affinity   -100..100  the ally rating. Do they like this person.
//   hostility     0..100  the rivalry rating. How much heat is between them.
//   respect       0..100  do they rate them as a wrestler.
//   trust         0..100  would they rely on them when it counts.
//
// These are genuinely independent. You can respect someone you cannot stand -
// that is most of the best rivalries in wrestling. You can like someone you
// would never trust. Two friends can carry real heat and still be friends. A
// single value collapses all of that into "how much do you like them", which is
// the least interesting of the four.
//
// Every relationship is DIRECTED. This is A's view of B and says nothing about
// B's view of A.

export const AXES = Object.freeze(['affinity', 'hostility', 'respect', 'trust']);

export const AXIS_RANGE = Object.freeze({
  affinity: { min: -100, max: 100, neutral: 0 },
  hostility: { min: 0, max: 100, neutral: 0 },
  respect: { min: 0, max: 100, neutral: 50 },
  trust: { min: 0, max: 100, neutral: 50 },
});

/** How many history entries a relationship keeps. The event log has the rest. */
export const HISTORY_LIMIT = 6;

export function clampAxis(axis, value) {
  const { min, max } = AXIS_RANGE[axis];
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function createRelationship(spec = {}, day = 0) {
  const seed = typeof spec === 'number' ? fromShorthand(spec) : spec;
  return {
    affinity: clampAxis('affinity', seed.affinity ?? 0),
    hostility: clampAxis('hostility', seed.hostility ?? 0),
    respect: clampAxis('respect', seed.respect ?? 50),
    trust: clampAxis('trust', seed.trust ?? 50),
    lastChangedDay: day,
    // Newest last, capped. What actually moved this relationship, in words.
    history: [],
  };
}

/**
 * A single number means "how much do they like them", which is all the authored
 * roster needs to say for most pairs. The other axes follow from it: someone
 * you dislike carries heat and cannot be relied on, someone you like can.
 */
export function fromShorthand(value) {
  return {
    affinity: value,
    hostility: value < 0 ? Math.min(100, -value * 0.8) : 0,
    respect: 50,
    trust: 50 + value * 0.4,
  };
}

/** Does this relationship exist as anything other than indifference? */
export function isNotable(rel) {
  return Math.abs(rel.affinity) >= 20 || rel.hostility >= 20
    || Math.abs(rel.respect - 50) >= 20 || Math.abs(rel.trust - 50) >= 20;
}

export const ALLY_THRESHOLD = 40;
export const ENEMY_THRESHOLD = -40;
export const RIVAL_THRESHOLD = 55;

export function isAlly(rel) { return rel.affinity >= ALLY_THRESHOLD; }
export function isEnemy(rel) { return rel.affinity <= ENEMY_THRESHOLD || rel.hostility >= 75; }

/** Heat without requiring dislike. This is what a feud is made of. */
export function isRival(rel) { return rel.hostility >= RIVAL_THRESHOLD; }

/**
 * One phrase for the whole relationship, for anywhere that has room for a label
 * rather than four numbers.
 */
export function describe(rel) {
  if (rel.hostility >= 75 && rel.respect >= 60) return 'bitter respect';
  if (rel.hostility >= 75) return 'hatred';
  if (rel.hostility >= RIVAL_THRESHOLD && rel.affinity >= 20) return 'friendly rivalry';
  if (rel.hostility >= RIVAL_THRESHOLD) return 'bad blood';
  if (rel.affinity >= 60 && rel.trust >= 60) return 'close ally';
  if (rel.affinity >= ALLY_THRESHOLD) return 'friendly';
  if (rel.affinity <= ENEMY_THRESHOLD) return 'dislike';
  if (rel.respect >= 70 && Math.abs(rel.affinity) < 20) return 'professional regard';
  if (rel.trust <= 25) return 'distrust';
  if (!isNotable(rel)) return 'indifferent';
  return 'wary';
}

/**
 * Apply signed deltas across any subset of axes and record what did it.
 * Returns the changes that actually landed, so the caller can decide whether
 * anything is worth reporting.
 */
export function applyDeltas(rel, deltas, { day, summary = '', eventId = null, type = '' } = {}) {
  const changed = {};
  for (const axis of AXES) {
    const delta = deltas[axis];
    if (!delta) continue;
    const before = rel[axis];
    const after = clampAxis(axis, before + delta);
    if (after === before) continue;
    rel[axis] = after;
    changed[axis] = after - before;
  }
  if (!Object.keys(changed).length) return changed;

  rel.lastChangedDay = day;
  rel.history.push({ day, type, summary, deltas: changed, eventId });
  if (rel.history.length > HISTORY_LIMIT) rel.history.splice(0, rel.history.length - HISTORY_LIMIT);
  return changed;
}

/** Structural check, used by the invariant checker. */
export function validateRelationship(rel) {
  const problems = [];
  for (const axis of AXES) {
    const v = rel?.[axis];
    if (!Number.isFinite(v)) { problems.push(`${axis} is not a number`); continue; }
    const { min, max } = AXIS_RANGE[axis];
    if (v < min || v > max) problems.push(`${axis} is ${v}, outside ${min}..${max}`);
  }
  if (!Array.isArray(rel?.history)) problems.push('history is not an array');
  else if (rel.history.length > HISTORY_LIMIT) problems.push(`history holds ${rel.history.length} entries`);
  return problems;
}
