// Display strings. Names are looked up from the roster at render time rather
// than copied onto show items, so ids stay the only link between the two.
import { nameOf } from '../model/wrestlers.js';

export function itemLabel(state, item) {
  if (item.type === 'match') {
    const [a, b] = item.participants;
    return `${nameOf(state.wrestlers, a)} vs. ${nameOf(state.wrestlers, b)}`;
  }
  return item.name || '(untitled segment)';
}

export function typeLabel(item) {
  return item.type === 'match' ? 'Match' : 'Segment';
}

export function minutes(n) {
  return `${n} min`;
}
