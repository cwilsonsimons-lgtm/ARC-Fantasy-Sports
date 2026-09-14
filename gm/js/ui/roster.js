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
import { notify } from '../store.js';
import { saveRoster } from '../rosters.js';
import { toRosterFile, toText } from '../model/roster-file.js';

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
    keepBar(state),
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

// ---------------------------------------------------------------- keeping it

// Interface state: what the last attempt to keep this roster said, and whether
// the text copy is open.
let kept = '';
let showText = '';

// Take this locker room with you.
//
// The people travel; the world does not. What gets kept is who they are — name,
// ability, personality, tastes, and the teams and mentorships that make the
// room a shape — and what gets left behind is everything that happened to them
// here. A roster dropped into a new promotion has not met that GM yet.
function keepBar(state) {
  return el('div', { class: 'keep-bar' },
    el('button', {
      type: 'button', class: 'btn',
      text: 'Keep this locker room',
      title: 'Save the roster so a future promotion can start with these people.',
      onClick: () => {
        const entry = saveRoster(state.wrestlers, state.promotion.promotion, `week ${state.week}`);
        kept = entry
          ? `Kept. "${entry.name}" is on the shelf for any new promotion.`
          : 'Could not keep it — browser storage is full.';
        showText = '';
        notify();
      },
    }),
    el('button', {
      type: 'button', class: 'link',
      text: showText ? 'Hide the text' : 'Copy as text',
      title: 'For moving a locker room to another browser, or sending it to somebody.',
      onClick: () => {
        showText = showText ? '' : toText(toRosterFile(state.wrestlers, state.promotion.promotion));
        kept = '';
        notify();
      },
    }),
    kept ? el('span', { class: 'muted', text: kept }) : null,
    showText
      ? el('textarea', {
          class: 'share-code keep-text', rows: 4, readonly: true, value: showText,
          onClick: e => e.target.select(),
        })
      : null
  );
}
