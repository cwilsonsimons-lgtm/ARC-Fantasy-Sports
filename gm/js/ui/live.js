// The GM at Gorilla while the show goes out, and the review once it is over.
// No simulation yet: every item takes exactly its planned time.
import { el } from './dom.js';
import { commit } from '../store.js';
import { PHASES, completeSegment, advanceWeek } from '../model/game.js';
import { itemById } from '../model/show.js';
import {
  currentItem, upcomingItems, airedItems, elapsedMinutes, remainingMinutes,
} from '../model/broadcast.js';
import { itemLabel, participantsLabel, typeLabel } from './labels.js';

export function renderLive(state, navigate) {
  if (state.phase === PHASES.LIVE) return liveView(state);
  if (state.phase === PHASES.AFTER) return aftermathView(state);

  return el('section', {},
    el('h2', { text: 'Live Show' }),
    el('p', { class: 'empty', text: `No show in progress. Week ${state.week} is still being booked.` }),
    el('button', { type: 'button', class: 'btn', text: 'Go to Booking', onClick: () => navigate('booking') })
  );
}

function liveView(state) {
  const { show, broadcast } = state;
  const item = currentItem(show, broadcast);
  const upcoming = upcomingItems(show, broadcast);
  const left = remainingMinutes(show, broadcast);

  return el('section', {},
    el('h2', { text: `Week ${state.week} — on the air` }),

    el('div', { class: 'onair' },
      el('div', { class: 'label', text: 'On air now' }),
      el('div', { class: 'title', text: itemLabel(state, item) }),
      el('div', { class: 'muted', text: `${typeLabel(item)} · ${participantsLabel(state, item)}` }),
      el('div', {}, 'Planned duration: ', el('b', { text: `${item.plannedMinutes} minutes` }))
    ),

    el('div', { class: 'totals' },
      el('div', {}, 'Current Show Time: ', el('b', { text: `${elapsedMinutes(broadcast)} minutes` })),
      el('div', {}, 'Time Remaining: ',
        el('b', { class: left < 0 ? 'over' : '', text: `${left} minutes` })
      ),
      el('div', {}, 'Show Length: ', el('b', { text: `${show.runtimeMinutes} minutes` }))
    ),

    left < 0 ? el('div', { class: 'notice warn', text: 'This show has run past its broadcast window.' }) : null,

    el('p', {},
      el('button', {
        type: 'button', class: 'btn primary', text: 'Complete Segment',
        onClick: () => commit(s => completeSegment(s)),
      })
    ),

    el('h3', { text: `Remaining rundown (${upcoming.length})` }),
    upcoming.length
      ? rundownTable(state, show, upcoming)
      : el('p', { class: 'empty', text: 'Nothing left after this. Completing it ends the show.' })
  );
}

function rundownTable(state, show, items) {
  const rows = items.map(item =>
    el('tr', {},
      el('td', { class: 'num', text: show.items.indexOf(item) + 1 }),
      el('td', { text: typeLabel(item) }),
      el('td', { text: itemLabel(state, item) }),
      el('td', { class: 'muted', text: participantsLabel(state, item) }),
      el('td', { class: 'num', text: `${item.plannedMinutes} min` })
    )
  );

  return el('table', {},
    el('thead', {},
      el('tr', {},
        el('th', { class: 'num', text: 'Pos' }),
        el('th', { text: 'Type' }),
        el('th', { text: 'Item' }),
        el('th', { text: 'Participants' }),
        el('th', { class: 'num', text: 'Planned' })
      )
    ),
    el('tbody', {}, rows)
  );
}

function aftermathView(state) {
  const { show, broadcast, week } = state;
  const aired = airedItems(show, broadcast);
  const total = elapsedMinutes(broadcast);
  const diff = total - show.runtimeMinutes;

  const rows = aired.map(({ item, result }, index) =>
    el('tr', {},
      el('td', { class: 'num', text: index + 1 }),
      el('td', { text: item ? typeLabel(item) : '—' }),
      el('td', { text: item ? itemLabel(state, item) : '(removed item)' }),
      el('td', { class: 'num', text: item ? `${item.plannedMinutes} min` : '—' }),
      el('td', { class: 'num', text: `${result.actualMinutes} min` })
    )
  );

  return el('section', {},
    el('h2', { text: `Week ${week} — Show Complete` }),

    el('div', { class: 'totals' },
      el('div', {}, 'Show Length: ', el('b', { text: `${show.runtimeMinutes} minutes` })),
      el('div', {}, 'Total Aired: ', el('b', { text: `${total} minutes` })),
      el('div', {}, diff === 0 ? 'Finished exactly on time.'
        : diff > 0 ? el('b', { class: 'over', text: `Ran ${diff} minutes long.` })
        : el('b', { text: `Finished ${Math.abs(diff)} minutes light.` }))
    ),

    el('h3', { text: 'What aired' }),
    el('table', {},
      el('thead', {},
        el('tr', {},
          el('th', { class: 'num', text: 'Pos' }),
          el('th', { text: 'Type' }),
          el('th', { text: 'Item' }),
          el('th', { class: 'num', text: 'Planned' }),
          el('th', { class: 'num', text: 'Actual' })
        )
      ),
      el('tbody', {}, rows)
    ),

    el('h3', { text: 'Show journal' }),
    journalList(state),

    el('button', {
      type: 'button', class: 'btn primary', text: `Start Week ${week + 1}`,
      onClick: () => commit(s => advanceWeek(s)),
    }),
    el('p', { class: 'muted', text: 'Advancing clears the card and opens booking for a new show.' })
  );
}

function journalList(state) {
  if (!state.journal.length) return el('p', { class: 'empty', text: 'Nothing recorded.' });

  return el('ol', { class: 'journal' },
    state.journal.map(entry =>
      el('li', {},
        el('span', { class: 'at', text: `${entry.at} min` }),
        journalText(state, entry)
      )
    )
  );
}

// Journal entries store references, not sentences. The wording lives here.
function journalText(state, entry) {
  if (entry.type === 'show-start') return 'The show goes on the air.';
  if (entry.type === 'show-end') return 'The broadcast ends.';

  const item = itemById(state.show, entry.itemId);
  const label = item ? itemLabel(state, item) : '(removed item)';
  const { plannedMinutes, actualMinutes } = entry.data;
  const timing = actualMinutes === plannedMinutes
    ? `ran its planned ${plannedMinutes} minutes`
    : `planned for ${plannedMinutes}, ran ${actualMinutes}`;
  return `${label} — ${timing}.`;
}
