// Read-only roster listing. Mood is a word, never a number.
import { el } from './dom.js';
import { moodWord, moodClass } from './mood.js';
import { bookable } from '../model/morale.js';
import { wrestlerLink } from './links.js';

export function renderRoster(state) {
  const rows = state.wrestlers.map(w =>
    el('tr', {},
      el('td', {},
        wrestlerLink(state, w.id),
        el('span', { class: 'sub', text: `${w.archetype} · ${w.role}` })
      ),
      el('td', { class: 'num', text: `${w.record.wins}–${w.record.losses}` }),
      el('td', { text: w.alignment }),
      el('td', { text: w.status }),
      el('td', {},
        bookable(w)
          ? el('span', { class: `mood-word ${moodClass(w)}`, text: moodWord(w) })
          : el('span', { class: 'muted', text: '—' })
      ),
      el('td', {},
        w.grudges.length ? el('span', { class: 'chip chip-bad', text: 'grudge' }) : null,
        w.weeksOffCard > 0 ? el('span', { class: 'chip', text: `off ${w.weeksOffCard}w` }) : null
      )
    )
  );

  return el('section', {},
    el('h2', { text: `Roster (${state.wrestlers.length})` }),
    el('p', { class: 'muted', text: 'Click any name to open their card. Demeanour is how they seem to you, never a number.' }),
    el('table', {},
      el('thead', {},
        el('tr', {},
          el('th', { text: 'Name' }),
          el('th', { class: 'num', text: 'W–L' }),
          el('th', { text: 'Alignment' }),
          el('th', { text: 'Status' }),
          el('th', { text: 'Demeanour' }),
          el('th', { text: '' })
        )
      ),
      el('tbody', {}, rows)
    )
  );
}
