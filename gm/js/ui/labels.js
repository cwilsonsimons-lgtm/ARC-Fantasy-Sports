// Display strings. Names are looked up from the roster at render time rather
// than copied onto show items, so ids stay the only link between the two.
import { nameOf } from '../model/wrestlers.js';
import { matchType } from '../data/match-types.js';
import { titleById } from '../model/titles.js';

export function itemLabel(state, item) {
  if (item.type !== 'match') return item.name || '(untitled segment)';

  const name = index => nameOf(state.wrestlers, item.participants[index]);
  const bout = item.tag && item.participants.length >= 4
    ? `${name(0)} & ${name(1)} vs. ${name(2)} & ${name(3)}`
    : `${name(0)} vs. ${name(1)}`;

  const title = item.titleId ? titleById(state, item.titleId) : null;
  return title ? `${title.name} — ${bout}` : bout;
}

export function typeLabel(item) {
  return item.type === 'match' ? matchType(item.matchType).name : 'Segment';
}

export function minutes(n) {
  return `${n} min`;
}
