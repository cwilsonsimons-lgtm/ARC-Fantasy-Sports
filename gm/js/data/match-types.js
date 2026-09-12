// The kinds of match you can book.
//
// Each type carries a minimum runtime, which is how match type reaches the show
// clock: an Iron Man match eats a quarter of your window whether you like it or
// not, so choosing a stipulation is a timing decision as well as a talent one.
//
// `chaos` is how much the result stops being about who is better. It is
// optional and defaults low — ability decides most matches — but a ring with
// eighteen people in it and no pinfalls is a different proposition, and the
// only honest way to say so is to let the best wrestler lose it more often.
//
// The shape of a match (how many sides, how many people on each) is not in
// here; it lives on the item as `sides`. See data/shapes.js.
export const MATCH_TYPES = [
  { id: 'singles',    name: 'Singles Match',     minMinutes: 5,
    note: 'One fall. Nobody has strong feelings about a singles match.' },
  { id: 'submission', name: 'Submission Match',  minMinutes: 10,
    note: 'No pinfalls. You win when they quit.' },
  { id: 'hardcore',   name: 'Hardcore Match',    minMinutes: 8,
    note: 'No disqualification, and whatever is not bolted down.' },
  { id: 'ladder',     name: 'Ladder Match',      minMinutes: 12,
    note: 'Spectacle, and a long way down.' },
  { id: 'cage',       name: 'Steel Cage Match',  minMinutes: 12,
    note: 'Nobody comes in. Nobody leaves.' },
  { id: 'lastman',    name: 'Last Man Standing', minMinutes: 14,
    note: 'A count of ten, and no pin will save you.' },
  { id: 'ironman',    name: 'Iron Man Match',    minMinutes: 25,
    note: 'Most falls inside the time limit. It eats your show.' },
  { id: 'battle-royal', name: 'Battle Royal',    minMinutes: 10, chaos: 0.5,
    open: true,
    note: 'Over the top rope, and as many of them as you like. Anybody can win one of these.' },
];

// The default weight given to everything that is not ability. Rises with the
// number of sides — the more people in it, the less the best of them decides.
export const BASE_CHAOS = 0.22;
export const CHAOS_PER_SIDE = 0.03;
export const MAX_CHAOS = 0.72;

export function chaosOf(matchTypeId, sideCount) {
  const declared = matchType(matchTypeId).chaos;
  const base = declared === undefined ? BASE_CHAOS : declared;
  return Math.min(MAX_CHAOS, base + Math.max(0, sideCount - 2) * CHAOS_PER_SIDE);
}

// Stipulations with no natural limit on how many can be in them.
export function isOpenType(matchTypeId) {
  return Boolean(matchType(matchTypeId).open);
}

export const DEFAULT_MATCH_TYPE = 'singles';

export function matchType(id) {
  return MATCH_TYPES.find(t => t.id === id) || MATCH_TYPES[0];
}
