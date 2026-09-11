// Any wrestler's name, anywhere, opens their card.
import { el } from './dom.js';
import { openCard } from './card-state.js';
import { nameOf } from '../model/wrestlers.js';
import { titleById } from '../model/titles.js';

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

// A match reads as its competitors, all clickable, with the belt in front of
// them when one is on the line. A segment is its name.
export function itemLabelNodes(state, item) {
  if (item.type !== 'match') return [item.name || '(untitled segment)'];

  const nodes = [];
  const title = item.titleId ? titleById(state, item.titleId) : null;
  if (title) nodes.push(el('span', { class: 'belt', text: title.name }), ' — ');

  const at = index => wrestlerLink(state, item.participants[index]);
  if (item.tag && item.participants.length >= 4) {
    nodes.push(at(0), ' & ', at(1), ' vs. ', at(2), ' & ', at(3));
  } else {
    nodes.push(at(0), ' vs. ', at(1));
  }
  return nodes;
}
