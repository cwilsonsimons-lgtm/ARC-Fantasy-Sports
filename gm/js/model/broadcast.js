// The live show. Kept separate from the card on purpose: the card is what the
// GM planned, the broadcast is what actually happened.
//
//   { showId, status, results: [{ itemId, actualMinutes, status }] }
//
// `results` is append-only. Each entry records what an item actually did, which
// is why `actualMinutes` exists even though it currently always equals the
// planned time — a match running long later is a different number here, not a
// change to this shape. `status` is 'aired' today; 'cut' and similar outcomes
// slot in later without touching the card.
//
// The current item is DERIVED (the first item with no result) rather than
// stored as a cursor index, so inserting or removing items mid-show later
// cannot desynchronise the position.
import { itemById } from './show.js';

export function createBroadcast(show) {
  return { showId: show.id, status: 'live', results: [] };
}

export function isLive(broadcast) {
  return Boolean(broadcast) && broadcast.status === 'live';
}

export function hasResult(broadcast, itemId) {
  return broadcast.results.some(r => r.itemId === itemId);
}

export function currentItem(show, broadcast) {
  return show.items.find(it => !hasResult(broadcast, it.id)) || null;
}

export function upcomingItems(show, broadcast) {
  const current = currentItem(show, broadcast);
  if (!current) return [];
  return show.items.slice(show.items.indexOf(current) + 1);
}

export function airedItems(show, broadcast) {
  return broadcast.results.map(r => ({ result: r, item: itemById(show, r.itemId) }));
}

export function elapsedMinutes(broadcast) {
  return broadcast.results.reduce((total, r) => total + r.actualMinutes, 0);
}

// Goes negative once a show runs past its window. Displayed, never prevented.
export function remainingMinutes(show, broadcast) {
  return show.runtimeMinutes - elapsedMinutes(broadcast);
}

// actualMinutes defaults to the planned time. Every future system that makes a
// segment run long, run short or get cut calls this with a different number —
// it does not need its own path through the broadcast.
export function completeCurrent(show, broadcast, actualMinutes = null) {
  const item = currentItem(show, broadcast);
  if (!item) return null;

  const result = {
    itemId: item.id,
    actualMinutes: actualMinutes === null ? item.plannedMinutes : Math.max(0, Math.round(actualMinutes)),
    status: 'aired',
  };
  broadcast.results.push(result);

  if (!currentItem(show, broadcast)) broadcast.status = 'complete';
  return result;
}

export function isComplete(broadcast) {
  return Boolean(broadcast) && broadcast.status === 'complete';
}
