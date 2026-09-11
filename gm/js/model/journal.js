// What happened during a show, in order.
//
// Entries are records rather than sentences: each carries a type, the show
// item it came from and the show-clock minute it happened at, so later code
// can ask "what happened to this item" instead of re-reading prose. The
// wording is composed at render time, the same way wrestler names are — no
// display string is ever copied into saved state.
//
//   { id, week, at, type, itemId, data }
//
// Types today are 'show-start', 'segment-complete' and 'show-end'. Incidents,
// requests and messages become new types; nothing else has to change.
import { nextId } from '../ids.js';

export function createEntry({ week, at, type, itemId = null, data = {} }) {
  return { id: nextId('jn'), week, at, type, itemId, data };
}
