// Read-only roster listing. Mood is a word, never a number.
import { el } from './dom.js';
import { moodWord, moodClass } from './mood.js';
import { bookable } from '../model/morale.js';

export function renderRoster(state) {
  const rows = state.wrestlers.map(w =>
    el('tr', {},
      el('td', {},
        el('b', { text: w.name }),
        el('span', { class: 'sub', text: w.archetype })
      ),
      el('td', { text: w.gender }),
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
    el('p', { class: 'muted', text: 'How people seem to you. There are no numbers here on purpose.' }),
    el('table', {},
      el('thead', {},
        el('tr', {},
          el('th', { text: 'Name' }),
          el('th', { text: 'Gender' }),
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
