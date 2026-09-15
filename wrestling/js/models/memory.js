// What a wrestler remembers.
//
// The memory itself lives on the wrestler (models/wrestler.js owns the shape
// and the decay). This file owns the VOCABULARY, for the same reason
// core/events.js owns the event vocabulary: a memory type that no system can
// recognise is a memory nothing will ever act on, and a system inventing its
// own string is a system nobody else can read.

/**
 * Weight and decay defaults per kind. `floor` is where it settles rather than
 * disappearing; `scar` forces a high floor so it never really goes away.
 *
 * The numbers encode a claim about wrestling: losing a championship or being
 * betrayed marks someone for years, while an ordinary win fades in weeks.
 */
export const MEMORY_TYPES = Object.freeze({
  // --- results ---
  WIN:              { key: 'win',              weight: 20, floor: 2,  decayPerDay: 0.9 },
  LOSS:             { key: 'loss',             weight: 30, floor: 2,  decayPerDay: 0.8 },
  UPSET_LOSS:       { key: 'upset_loss',       weight: 55, floor: 12, decayPerDay: 0.6 },
  DRAW:             { key: 'draw',             weight: 22, floor: 4,  decayPerDay: 0.7 },

  // --- how it was done ---
  CHEATED:          { key: 'cheated',          weight: 70, floor: 25, decayPerDay: 0.35 },
  LUCKY_ESCAPE:     { key: 'lucky_escape',     weight: 45, floor: 8,  decayPerDay: 0.5 },
  HUMILIATION:      { key: 'humiliation',      weight: 78, floor: 42, decayPerDay: 0.15, scar: true },

  // --- championships ---
  TITLE_WIN:        { key: 'title_win',        weight: 92, floor: 50, decayPerDay: 0.08, scar: true },
  TITLE_LOSS:       { key: 'title_loss',       weight: 96, floor: 55, decayPerDay: 0.06, scar: true },
  TITLE_SHOT:       { key: 'title_shot',       weight: 60, floor: 18, decayPerDay: 0.3 },
  TITLE_SHOT_DENIED:{ key: 'title_shot_denied', weight: 75, floor: 30, decayPerDay: 0.2 },

  // --- how the GM treated them ---
  CUT_FROM_SHOW:    { key: 'cut_from_show',    weight: 62, floor: 20, decayPerDay: 0.3 },
  OVERLOOKED:       { key: 'overlooked',       weight: 40, floor: 10, decayPerDay: 0.45 },
  PROMISE_KEPT:     { key: 'promise_kept',     weight: 65, floor: 25, decayPerDay: 0.2 },
  PROMISE_BROKEN:   { key: 'gm_promise_broken', weight: 85, floor: 55, decayPerDay: 0.1, scar: true },
  SUSPENSION:       { key: 'suspension',       weight: 80, floor: 40, decayPerDay: 0.15, scar: true },

  // --- asking for things ---
  REQUEST_GRANTED:  { key: 'request_granted',  weight: 58, floor: 20, decayPerDay: 0.3 },
  REQUEST_DENIED:   { key: 'request_denied',   weight: 55, floor: 18, decayPerDay: 0.3 },
  REQUEST_IGNORED:  { key: 'request_ignored',  weight: 72, floor: 32, decayPerDay: 0.18 },

  // --- between wrestlers ---
  BETRAYAL:         { key: 'betrayal',         weight: 95, floor: 60, decayPerDay: 0.05, scar: true },
  SAVE:             { key: 'save',             weight: 80, floor: 40, decayPerDay: 0.12, scar: true },
  KINDNESS:         { key: 'kindness',         weight: 55, floor: 25, decayPerDay: 0.2 },
  TEAMED_WELL:      { key: 'teamed_well',      weight: 35, floor: 8,  decayPerDay: 0.5 },
  TEAMED_BADLY:     { key: 'teamed_badly',     weight: 45, floor: 12, decayPerDay: 0.4 },

  // --- authored backstory ---
  CAREER:           { key: 'career',           weight: 70, floor: 45, decayPerDay: 0.2, scar: true },
  INJURY:           { key: 'injury',           weight: 50, floor: 20, decayPerDay: 0.3 },
  STANDING:         { key: 'standing',         weight: 60, floor: 20, decayPerDay: 0.4 },
});

const BY_KEY = Object.freeze(
  Object.fromEntries(Object.values(MEMORY_TYPES).map((t) => [t.key, t]))
);

export function memoryTypeOf(key) {
  return BY_KEY[key] || null;
}

export function isKnownMemoryType(key) {
  return key in BY_KEY;
}

export const MEMORY_KEYS = Object.freeze(Object.keys(BY_KEY));

/**
 * Fill in the defaults for a kind, so a caller writes the story and the
 * vocabulary decides how long it lasts. An explicit weight still wins.
 */
export function memorySpec(typeKey, spec = {}) {
  const preset = memoryTypeOf(typeKey);
  if (!preset) throw new Error(`Unknown memory type "${typeKey}". Add it to MEMORY_TYPES.`);
  return {
    weight: preset.weight,
    floor: preset.floor,
    decayPerDay: preset.decayPerDay,
    scar: !!preset.scar,
    ...spec,
    type: typeKey,
  };
}

/** Memories that make a wrestler dislike whoever they are about. */
export const GRUDGE_TYPES = Object.freeze([
  MEMORY_TYPES.LOSS.key, MEMORY_TYPES.UPSET_LOSS.key, MEMORY_TYPES.CHEATED.key,
  MEMORY_TYPES.HUMILIATION.key, MEMORY_TYPES.TITLE_LOSS.key, MEMORY_TYPES.BETRAYAL.key,
  MEMORY_TYPES.TEAMED_BADLY.key,
]);

/** Memories about the GM rather than another wrestler. */
export const GM_MEMORY_TYPES = Object.freeze([
  MEMORY_TYPES.REQUEST_GRANTED.key, MEMORY_TYPES.REQUEST_DENIED.key,
  MEMORY_TYPES.REQUEST_IGNORED.key,
  MEMORY_TYPES.CUT_FROM_SHOW.key, MEMORY_TYPES.OVERLOOKED.key,
  MEMORY_TYPES.PROMISE_KEPT.key, MEMORY_TYPES.PROMISE_BROKEN.key,
  MEMORY_TYPES.SUSPENSION.key, MEMORY_TYPES.TITLE_SHOT.key,
  MEMORY_TYPES.TITLE_SHOT_DENIED.key,
]);
