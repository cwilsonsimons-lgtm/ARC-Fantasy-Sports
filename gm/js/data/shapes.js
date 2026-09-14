// The shape of a match: how many sides, and how many people on each.
//
// `participants` stays the one list of who is in a match — everything from
// whereabouts to morale to threads reads it — and `sides` says how that list
// divides:
//
//   [1, 1]          a singles match
//   [2, 2]          a tag match
//   [3, 3]          six people, two teams
//   [2, 1]          a handicap match
//   [1, 1, 1]       a triple threat
//   [1, 1, 1, 1]    a fatal four-way
//   [1] x 18        a battle royal
//
// One list and one description of how it is cut, rather than two lists that can
// disagree. A match used to carry a boolean `tag` and slice the participants at
// index two, which is why nothing bigger than four people could exist.
//
// The *name* is derived rather than stored, so a shape cannot be labelled one
// thing and behave as another.

// Individual sides, by how many there are.
const WAY_NAMES = {
  3: 'Triple Threat',
  4: 'Fatal Four-Way',
  5: 'Five-Way',
  6: 'Six-Way',
  7: 'Seven-Way',
  8: 'Eight-Way',
};

// Bodies, for naming a tag match by its total rather than its sides — "six
// people, two teams" is a six-person tag, not a three-a-side tag.
const PEOPLE = {
  6: 'Six', 8: 'Eight', 10: 'Ten', 12: 'Twelve', 14: 'Fourteen', 16: 'Sixteen',
};

const SIDE_WORDS = { 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight' };

export function totalIn(sides) {
  return sides.reduce((sum, n) => sum + n, 0);
}

// What this shape is called. An empty name means the shape adds nothing to the
// stipulation — a plain singles match is just its stipulation.
export function shapeName(sides, matchTypeId = null) {
  if (matchTypeId === 'battle-royal') return 'Battle Royal';
  if (!Array.isArray(sides) || sides.length < 2) return '';

  const count = sides.length;
  const total = totalIn(sides);

  if (sides.every(n => n === 1)) {
    if (count === 2) return '';
    return WAY_NAMES[count] || `${count}-Way`;
  }

  // Somebody is outnumbered. That is the whole character of the match, so it
  // outranks any name built from the totals.
  if (!sides.every(n => n === sides[0])) return 'Handicap';

  if (count === 2) return sides[0] === 2 ? 'Tag Team' : `${PEOPLE[total] || total}-Person Tag`;
  return `${SIDE_WORDS[count] || count}-Way Tag`;
}

// How long a shape needs before the stipulation has its say. Bodies take time
// to get in and out of a ring, which is how a twenty-person battle royal
// becomes a real claim on an hour show rather than a free spectacle.
export function shapeMinutes(sides, matchTypeId = null) {
  const total = totalIn(sides);
  if (matchTypeId === 'battle-royal') return 4 + total;
  return 3 + total;
}

export function isMultiWay(sides) {
  return Array.isArray(sides) && sides.length > 2;
}

// ---------------------------------------------------------------- booking

// What the booking screen offers. `sides` is the starting arrangement; the
// player can leave slots empty to make it lopsided, and the name follows.
export const PRESETS = [
  { id: 'tag', label: 'Tag team', sides: [2, 2] },
  { id: 'six-tag', label: 'Six-person tag', sides: [3, 3] },
  { id: 'eight-tag', label: 'Eight-person tag', sides: [4, 4] },
  { id: 'tag3', label: 'Three-way tag', sides: [2, 2, 2] },
  { id: 'triple', label: 'Triple threat', sides: [1, 1, 1] },
  { id: 'fatal4', label: 'Fatal four-way', sides: [1, 1, 1, 1] },
  { id: 'five', label: 'Five-way', sides: [1, 1, 1, 1, 1] },
  { id: 'six', label: 'Six-way', sides: [1, 1, 1, 1, 1, 1] },
  { id: 'seven', label: 'Seven-way', sides: [1, 1, 1, 1, 1, 1, 1] },
  { id: 'eight', label: 'Eight-way', sides: [1, 1, 1, 1, 1, 1, 1, 1] },
  { id: 'royal', label: 'Battle royal', open: true },
];

export const MAX_SIDES = 8;
export const MAX_PER_SIDE = 8;

export function preset(id) {
  return PRESETS.find(p => p.id === id) || PRESETS[0];
}

// Sides of equal size, for the custom builder.
export function evenSides(count, perSide) {
  const sides = Math.max(2, Math.min(MAX_SIDES, Math.round(count) || 2));
  const each = Math.max(1, Math.min(MAX_PER_SIDE, Math.round(perSide) || 1));
  return new Array(sides).fill(each);
}
