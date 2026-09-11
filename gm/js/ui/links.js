// Any wrestler's name, anywhere, opens their card.
import { el } from './dom.js';
import { openCard } from './card-state.js';
import { nameOf } from '../model/wrestlers.js';

export function wrestlerLink(state, id) {
  return el('button', {
    type: 'button',
    class: 'wlink',
    text: nameOf(state.wrestlers, id),
    onClick: () => openCard(id),
  });
}

export function participantLinks(state, ids) {
  if (!ids.length) return [el('span', { class: 'muted', text: '—' })];
  const out = [];
  ids.forEach((id, i) => {
    if (i) out.push(', ');
    out.push(wrestlerLink(state, id));
  });
  return out;
}

// A match reads as its two competitors, both clickable. A segment is its name.
export function itemLabelNodes(state, item) {
  if (item.type !== 'match') return [item.name || '(untitled segment)'];
  const [a, b] = item.participants;
  return [wrestlerLink(state, a), ' vs. ', wrestlerLink(state, b)];
}
