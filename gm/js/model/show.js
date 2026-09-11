// The show card: a Show is an ordered collection of ShowItems.
//
// Matches and segments deliberately share one record shape, so anything that
// walks the card (the live screen now; cuts, insertions and incidents later)
// never has to branch on type:
//
//   { id, type, name, participants: [wrestlerId], plannedMinutes }
//
//   id             stable, so future events can reference this exact item
//   type           'match' | 'segment'
//   name           segments carry their own name; matches derive theirs from
//                  their participants at display time
//   participants   wrestler ids, in order (a match is [wrestlerA, wrestlerB])
//   plannedMinutes what the GM booked. What actually aired is recorded on the
//                  broadcast, not here, so planned and actual never overwrite
//                  each other.
//
// Position on the card is the index in `items`. It is not stored on the item,
// so reordering can never leave two items claiming the same slot.
import { nextId } from '../ids.js';
import { matchType, DEFAULT_MATCH_TYPE } from '../data/match-types.js';

// An hour to start with. The window is earned — see model/network.js.
export const DEFAULT_RUNTIME_MINUTES = 60;

export function createShow({ name = 'Weekly Show', runtimeMinutes = DEFAULT_RUNTIME_MINUTES } = {}) {
  return { id: nextId('show'), name, runtimeMinutes, items: [] };
}

export function createMatch({ wrestlerAId, wrestlerBId, plannedMinutes, matchTypeId = DEFAULT_MATCH_TYPE }) {
  const stipulation = matchType(matchTypeId);
  return {
    id: nextId('si'),
    type: 'match',
    matchType: stipulation.id,
    name: '',
    participants: [wrestlerAId, wrestlerBId],
    plannedMinutes: Math.max(stipulation.minMinutes, clampMinutes(plannedMinutes)),
  };
}

export function createSegment({ name, participants = [], plannedMinutes }) {
  return {
    id: nextId('si'),
    type: 'segment',
    name: name.trim(),
    participants: [...participants],
    plannedMinutes: clampMinutes(plannedMinutes),
  };
}

export function addItem(show, item) {
  show.items.push(item);
  return item;
}

export function removeItem(show, itemId) {
  const i = indexOf(show, itemId);
  if (i === -1) return false;
  show.items.splice(i, 1);
  return true;
}

// delta of -1 moves the item one position earlier, +1 one position later.
export function moveItem(show, itemId, delta) {
  const from = indexOf(show, itemId);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= show.items.length) return false;
  const [item] = show.items.splice(from, 1);
  show.items.splice(to, 0, item);
  return true;
}

export function setItemMinutes(show, itemId, minutes) {
  const item = itemById(show, itemId);
  if (!item) return false;
  item.plannedMinutes = Math.max(minimumMinutes(item), clampMinutes(minutes));
  return true;
}

// Changing the stipulation can raise the floor under the segment: you cannot
// book a twenty-five minute Iron Man match into an eight minute slot.
export function setItemMatchType(show, itemId, matchTypeId) {
  const item = itemById(show, itemId);
  if (!item || item.type !== 'match') return false;
  item.matchType = matchType(matchTypeId).id;
  item.plannedMinutes = Math.max(minimumMinutes(item), item.plannedMinutes);
  return true;
}

export function minimumMinutes(item) {
  return item.type === 'match' ? matchType(item.matchType).minMinutes : 1;
}

export function itemById(show, itemId) {
  return show.items.find(it => it.id === itemId) || null;
}

export function indexOf(show, itemId) {
  return show.items.findIndex(it => it.id === itemId);
}

export function bookedMinutes(show) {
  return show.items.reduce((total, it) => total + it.plannedMinutes, 0);
}

// Negative when the card is overbooked. The UI warns; it never blocks.
export function remainingMinutes(show) {
  return show.runtimeMinutes - bookedMinutes(show);
}

export function isOverbooked(show) {
  return bookedMinutes(show) > show.runtimeMinutes;
}

function clampMinutes(minutes) {
  const n = Math.round(Number(minutes));
  return Number.isFinite(n) && n > 0 ? n : 1;
}
