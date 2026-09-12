// The roster listing. Mood is a word, never a number.
//
// One thing here is not read-only: an indefinite suspension has no end date, so
// the only way it ends is you deciding it has. Every other length runs out on
// its own, which is exactly what makes that rung of the ladder different.
import { el } from './dom.js';
import { commit } from '../store.js';
import { moodWord, moodClass } from './mood.js';
import { bookable } from '../model/morale.js';
import { reinstate, indefinitelySuspended } from '../model/discipline.js';
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
      el('td', {},
        w.status,
        w.suspendedUntil === 'indefinite'
          ? el('span', { class: 'sub', text: 'suspended indefinitely' })
          : Number.isFinite(w.suspendedUntil)
            ? el('span', { class: 'sub', text: `back in week ${w.suspendedUntil}` })
            : null
      ),
      el('td', {},
        bookable(w)
          ? el('span', { class: `mood-word ${moodClass(w)}`, text: moodWord(w) })
          : el('span', { class: 'muted', text: '—' })
      ),
      el('td', {},
        w.grudges.length ? el('span', { class: 'chip chip-bad', text: 'grudge' }) : null,
        w.weeksOffCard > 0 ? el('span', { class: 'chip', text: `off ${w.weeksOffCard}w` }) : null,
        w.suspendedUntil === 'indefinite'
          ? el('button', {
              type: 'button', class: 'btn small',
              text: 'Bring them back',
              onClick: () => commit(s => reinstate(s, w.id)),
            })
          : null
      )
    )
  );

  const held = indefinitelySuspended(state);

  return el('section', {},
    el('h2', { text: `Roster (${state.wrestlers.length})` }),
    el('p', { class: 'muted', text: 'Click any name to open their card. Demeanour is how they seem to you, never a number.' }),
    held.length
      ? el('div', { class: 'notice warn' },
          `${held.length === 1 ? 'One wrestler is' : `${held.length} wrestlers are`} suspended indefinitely. `
          + 'That does not end on its own, and neither does the hole it leaves in your card.')
      : null,
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
