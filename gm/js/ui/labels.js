// Display strings. Names are looked up from the roster at render time rather
// than copied onto show items, so ids stay the only link between the two.
import { nameOf } from '../model/wrestlers.js';
import { matchType } from '../data/match-types.js';
import { titleById } from '../model/titles.js';
import { teamsOf } from '../model/matches.js';
import { shapeName } from '../data/shapes.js';

// Past this many people, naming them all is a paragraph rather than a label.
const TOO_MANY_TO_LIST = 6;

export function itemLabel(state, item) {
  if (item.type !== 'match') return item.name || '(untitled segment)';

  const title = item.titleId ? titleById(state, item.titleId) : null;
  const bout = boutText(state, item);
  return title ? `${title.name} — ${bout}` : bout;
}

function boutText(state, item) {
  const sides = teamsOf(item);
  const shape = shapeName(item.sides, item.matchType);

  if (item.participants.length > TOO_MANY_TO_LIST) {
    return `${shape || 'Match'} · ${item.participants.length} wrestlers`;
  }
  return sides
    .map(side => side.map(id => nameOf(state.wrestlers, id)).join(' & '))
    .join(' vs. ');
}

// The stipulation and the shape are different things, and a match can be both:
// a Fatal Four-Way Ladder Match is a shape and a stipulation. A plain singles
// match has no shape to announce, so it reads as its stipulation alone.
export function typeLabel(item) {
  if (item.type !== 'match') return item.kind === 'promo' ? 'Promo' : 'Segment';
  const stipulation = matchType(item.matchType);
  const shape = shapeName(item.sides, item.matchType);
  if (!shape) return stipulation.name;
  if (item.matchType === 'battle-royal') return shape;
  if (item.matchType === 'singles') return `${shape} Match`;
  return `${shape} ${stipulation.name}`;
}

export function minutes(n) {
  return `${n} min`;
}
