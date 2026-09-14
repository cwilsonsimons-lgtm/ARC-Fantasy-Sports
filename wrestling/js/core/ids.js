// Typed, human-readable, monotonically minted entity IDs.
//
// Every entity is addressed by one of these for its entire life. A wrestler is
// `w_0003` in the roster, in a match, in a relationship, in a memory, in the
// event log and in the save file. There is never a second copy of that wrestler
// living inside another system - only this string.
//
// IDs are readable on purpose. The design's memory log is meant to be the
// debugging window into the simulation, and `w_0003 resented sg_0012` is
// readable in a way a UUID is not.

// Every entity type in the game, including ones no system has been built for
// yet. Reserving the prefix here is what stops a future system from inventing
// its own parallel ID scheme.
export const ID_TYPES = Object.freeze({
  // built now
  wrestler:      'w',
  show:          'sh',
  segment:       'sg',
  event:         'ev',
  calendarEntry: 'cal',
  memory:        'mem',
  // reserved for systems named in the design foundation but not yet built
  promise:       'pr',
  incident:      'inc',
  rivalry:       'rv',
  team:          'tm',
  title:         'ttl',
  contract:      'ct',
});

const PREFIX_TO_TYPE = Object.freeze(
  Object.fromEntries(Object.entries(ID_TYPES).map(([type, prefix]) => [prefix, type]))
);

const PAD = 4;

// Counter state lives here but is owned by the save file: persist.js exports it
// on save and imports it on load, so IDs never collide across a save/load cycle.
let counters = Object.create(null);

/** Mint the next ID for a type. Counters are never reused, even after a delete. */
export function mint(type) {
  const prefix = ID_TYPES[type];
  if (!prefix) throw new Error(`mint: unknown entity type "${type}"`);
  const n = (counters[type] || 0) + 1;
  counters[type] = n;
  return `${prefix}_${String(n).padStart(PAD, '0')}`;
}

/** The value `mint` would return next, without consuming it. */
export function peek(type) {
  const prefix = ID_TYPES[type];
  if (!prefix) throw new Error(`peek: unknown entity type "${type}"`);
  return `${prefix}_${String((counters[type] || 0) + 1).padStart(PAD, '0')}`;
}

/** Entity type of an ID string, or null if it is not one of ours. */
export function typeOf(id) {
  if (typeof id !== 'string') return null;
  const i = id.indexOf('_');
  if (i < 1) return null;
  return PREFIX_TO_TYPE[id.slice(0, i)] || null;
}

/** True when `v` is an ID, optionally of a specific type. */
export function isId(v, type) {
  const t = typeOf(v);
  if (!t) return false;
  return type ? t === type : true;
}

/** Throw unless `v` is an ID of `type`. Used at every system boundary. */
export function assertId(v, type, context = '') {
  if (!isId(v, type)) {
    throw new Error(
      `Expected a ${type} id${context ? ` for ${context}` : ''}, got ${JSON.stringify(v)}`
    );
  }
  return v;
}

/** Numeric part of an ID, for sorting by creation order. */
export function ordinalOf(id) {
  const i = String(id).indexOf('_');
  return i < 0 ? NaN : Number(id.slice(i + 1));
}

export function exportCounters() {
  return { ...counters };
}

export function importCounters(next) {
  counters = Object.create(null);
  for (const [k, v] of Object.entries(next || {})) {
    if (ID_TYPES[k] && Number.isFinite(v)) counters[k] = v;
  }
}

export function resetCounters() {
  counters = Object.create(null);
}

/**
 * Safety net after loading a save written by an older or hand-edited build:
 * push every counter past the highest ID actually present, so a mint can never
 * collide with an entity already in the state.
 */
export function syncCountersTo(ids) {
  for (const id of ids) {
    const type = typeOf(id);
    if (!type) continue;
    const n = ordinalOf(id);
    if (Number.isFinite(n) && n > (counters[type] || 0)) counters[type] = n;
  }
}
