// Any wrestler's name, anywhere, opens their card.
import { el } from './dom.js';
import { openCard } from './card-state.js';
import { nameOf } from '../model/wrestlers.js';
import { titleById } from '../model/titles.js';
import { teamsOf } from '../model/matches.js';
import { shapeName } from '../data/shapes.js';

// Past this many people, naming them all is a paragraph rather than a label.
const TOO_MANY_TO_LIST = 6;

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
//
// Any shape: two names, two teams of four, or eighteen people over the top
// rope — past a handful the label says what it is and how many are in it, and
// the rundown's own participants column does the naming.
export function itemLabelNodes(state, item) {
  if (item.type !== 'match') return [item.name || '(untitled segment)'];

  const nodes = [];
  const title = item.titleId ? titleById(state, item.titleId) : null;
  if (title) nodes.push(el('span', { class: 'belt', text: title.name }), ' — ');

  if (item.participants.length > TOO_MANY_TO_LIST) {
    nodes.push(el('span', { class: 'shape', text: shapeName(item.sides, item.matchType) || 'Match' }));
    nodes.push(` · ${item.participants.length} wrestlers`);
    return nodes;
  }

  teamsOf(item).forEach((side, index) => {
    if (index) nodes.push(' vs. ');
    side.forEach((id, seat) => {
      if (seat) nodes.push(' & ');
      nodes.push(wrestlerLink(state, id));
    });
  });
  return nodes;
}
