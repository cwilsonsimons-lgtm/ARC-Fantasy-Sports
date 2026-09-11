// Build the card for the next show: add, remove, reorder and retime items.
import { el } from './dom.js';
import { commit, notify } from '../store.js';
import {
  addItem, createMatch, createSegment, removeItem, moveItem, setItemMinutes,
  bookedMinutes, remainingMinutes, isOverbooked,
} from '../model/show.js';
import { PHASES, canEditCard, startShow } from '../model/game.js';
import { itemLabel, participantsLabel, typeLabel } from './labels.js';
import { bookable } from '../model/morale.js';
import { moodWord, moodClass } from './mood.js';

// Half-typed form values live here rather than in game state, so a redraw
// (triggered by any commit) does not wipe what the user is in the middle of.
const draft = {
  matchA: '', matchB: '', matchMinutes: 10, matchError: '',
  segName: '', segParticipants: new Set(), segMinutes: 5, segError: '',
};

export function renderBooking(state, navigate) {
  const { show } = state;
  const locked = !canEditCard(state);

  return el('section', {},
    el('h2', { text: `Week ${state.week} — Booking` }),
    locked ? lockedNotice(state, navigate) : null,
    totals(show),
    isOverbooked(show)
      ? el('div', {
          class: 'notice warn',
          text: `Overbooked by ${bookedMinutes(show) - show.runtimeMinutes} minutes. You can still run this card.`,
        })
      : null,
    cardTable(state, show, locked),
    offTheCard(state),
    locked ? null : addMatchPanel(state),
    locked ? null : addSegmentPanel(state),
    el('div', {},
      el('button', {
        type: 'button',
        class: 'btn primary',
        text: 'Start Show',
        disabled: locked || show.items.length === 0,
        onClick: () => {
          commit(s => startShow(s));
          navigate('live');
        },
      }),
      show.items.length === 0
        ? el('span', { class: 'muted', text: '  Add at least one item to start the show.' })
        : null
    )
  );
}

function lockedNotice(state, navigate) {
  const onAir = state.phase === PHASES.LIVE;
  return el('div', { class: 'notice' },
    onAir
      ? 'A show is currently on the air, so the card is locked. '
      : `Week ${state.week} is over. Advance the week to book the next show. `,
    el('button', {
      type: 'button', class: 'link',
      text: onAir ? 'Go to the live show' : 'Go to the aftermath',
      onClick: () => navigate('live'),
    })
  );
}

function totals(show) {
  const left = remainingMinutes(show);
  return el('div', { class: 'totals' },
    el('div', {}, 'Show Length: ', el('b', { text: `${show.runtimeMinutes} minutes` })),
    el('div', {}, 'Time Booked: ', el('b', { text: `${bookedMinutes(show)} minutes` })),
    el('div', {}, 'Time Remaining: ',
      el('b', { class: left < 0 ? 'over' : '', text: `${left} minutes` })
    )
  );
}

function cardTable(state, show, locked) {
  if (!show.items.length) {
    return el('p', { class: 'empty', text: 'No items on the card yet.' });
  }

  const rows = show.items.map((item, index) =>
    el('tr', {},
      el('td', { class: 'num', text: index + 1 }),
      el('td', { text: typeLabel(item) }),
      el('td', { text: itemLabel(state, item) }),
      el('td', { class: 'muted', text: participantsLabel(state, item) }),
      el('td', { class: 'num' },
        el('input', {
          type: 'number', min: '1', value: item.plannedMinutes, disabled: locked,
          onChange: e => commit(s => setItemMinutes(s.show, item.id, e.target.value)),
        })
      ),
      el('td', {},
        el('button', {
          type: 'button', class: 'btn small', text: 'Up',
          disabled: locked || index === 0,
          onClick: () => commit(s => moveItem(s.show, item.id, -1)),
        }),
        ' ',
        el('button', {
          type: 'button', class: 'btn small', text: 'Down',
          disabled: locked || index === show.items.length - 1,
          onClick: () => commit(s => moveItem(s.show, item.id, 1)),
        }),
        ' ',
        el('button', {
          type: 'button', class: 'btn small', text: 'Remove',
          disabled: locked,
          onClick: () => commit(s => removeItem(s.show, item.id)),
        })
      )
    )
  );

  return el('table', {},
    el('thead', {},
      el('tr', {},
        el('th', { class: 'num', text: 'Pos' }),
        el('th', { text: 'Type' }),
        el('th', { text: 'Item' }),
        el('th', { text: 'Participants' }),
        el('th', { class: 'num', text: 'Planned' }),
        el('th', { text: 'Actions' })
      )
    ),
    el('tbody', {}, rows)
  );
}

// Who is available and not booked. Being left off is the one thing in the game
// today that actually moves morale, so the player has to be able to see it
// before the show, not only learn about it afterwards.
function offTheCard(state) {
  const booked = new Set(state.show.items.flatMap(item => item.participants));
  const idle = state.wrestlers.filter(w => bookable(w) && !booked.has(w.id));

  if (!idle.length) {
    return el('div', { class: 'panel' },
      el('h3', { text: 'Off the card' }),
      el('p', { class: 'empty', text: 'Everyone available is booked. Nobody is sitting at home this week.' })
    );
  }

  return el('div', { class: 'panel' },
    el('h3', { text: `Off the card (${idle.length})` }),
    el('ul', { class: 'moods compact' },
      idle.map(w =>
        el('li', {},
          el('span', { class: 'mood-name', text: w.name }),
          el('span', { class: 'mood-arch', text: w.archetype }),
          el('span', { class: `mood-word ${moodClass(w)}`, text: moodWord(w) }),
          w.weeksOffCard > 0
            ? el('span', {
                class: w.weeksOffCard >= 2 ? 'chip chip-bad' : 'chip',
                text: `missed ${w.weeksOffCard}`,
              })
            : null
        )
      )
    )
  );
}

function wrestlerOptions(state, selected) {
  return [
    el('option', { value: '', text: '— choose —', selected: selected === '' }),
    ...state.wrestlers.map(w =>
      el('option', {
        value: w.id,
        selected: w.id === selected,
        text: w.status === 'Available' ? w.name : `${w.name} (${w.status})`,
      })
    ),
  ];
}

function addMatchPanel(state) {
  return el('div', { class: 'panel' },
    el('h3', { text: 'Add match' }),
    el('div', { class: 'row' },
      el('div', { class: 'field' },
        el('label', { text: 'Wrestler A' }),
        el('select', { onChange: e => { draft.matchA = e.target.value; } }, wrestlerOptions(state, draft.matchA))
      ),
      el('div', { class: 'field' },
        el('label', { text: 'Wrestler B' }),
        el('select', { onChange: e => { draft.matchB = e.target.value; } }, wrestlerOptions(state, draft.matchB))
      ),
      el('div', { class: 'field' },
        el('label', { text: 'Planned minutes' }),
        el('input', {
          type: 'number', min: '1', value: draft.matchMinutes,
          onChange: e => { draft.matchMinutes = e.target.value; },
        })
      ),
      el('button', { type: 'button', class: 'btn', text: 'Add match', onClick: addMatch })
    ),
    draft.matchError ? el('p', { class: 'over', text: draft.matchError }) : null
  );
}

function addMatch() {
  if (!draft.matchA || !draft.matchB) {
    draft.matchError = 'Choose both wrestlers.';
    notify();
    return;
  }
  if (draft.matchA === draft.matchB) {
    draft.matchError = 'A wrestler cannot face themselves.';
    notify();
    return;
  }

  const match = { wrestlerAId: draft.matchA, wrestlerBId: draft.matchB, plannedMinutes: draft.matchMinutes };
  draft.matchA = '';
  draft.matchB = '';
  draft.matchError = '';
  commit(s => addItem(s.show, createMatch(match)));
}

function addSegmentPanel(state) {
  const checks = state.wrestlers.map(w =>
    el('label', {},
      el('input', {
        type: 'checkbox',
        checked: draft.segParticipants.has(w.id),
        onChange: e => {
          if (e.target.checked) draft.segParticipants.add(w.id);
          else draft.segParticipants.delete(w.id);
        },
      }),
      ' ', w.name
    )
  );

  return el('div', { class: 'panel' },
    el('h3', { text: 'Add segment' }),
    el('div', { class: 'row' },
      el('div', { class: 'field' },
        el('label', { text: 'Segment name' }),
        el('input', {
          type: 'text', value: draft.segName, placeholder: 'Contract signing',
          onChange: e => { draft.segName = e.target.value; },
        })
      ),
      el('div', { class: 'field' },
        el('label', { text: 'Wrestlers involved (optional)' }),
        el('div', { class: 'checklist' }, checks)
      ),
      el('div', { class: 'field' },
        el('label', { text: 'Planned minutes' }),
        el('input', {
          type: 'number', min: '1', value: draft.segMinutes,
          onChange: e => { draft.segMinutes = e.target.value; },
        })
      ),
      el('button', { type: 'button', class: 'btn', text: 'Add segment', onClick: addSegment })
    ),
    draft.segError ? el('p', { class: 'over', text: draft.segError }) : null
  );
}

function addSegment() {
  if (!draft.segName.trim()) {
    draft.segError = 'Give the segment a name.';
    notify();
    return;
  }

  const segment = {
    name: draft.segName,
    participants: [...draft.segParticipants],
    plannedMinutes: draft.segMinutes,
  };
  draft.segName = '';
  draft.segParticipants = new Set();
  draft.segError = '';
  commit(s => addItem(s.show, createSegment(segment)));
}
