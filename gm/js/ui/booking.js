// Build the card for the next show: add, remove, reorder and retime items.
import { el } from './dom.js';
import { commit, notify } from '../store.js';
import {
  addItem, createMatch, createSegment, removeItem, moveItem, setItemMinutes,
  bookedMinutes, remainingMinutes, isOverbooked,
} from '../model/show.js';
import { createBroadcast, isLive } from '../model/broadcast.js';
import { itemLabel, participantsLabel, typeLabel } from './labels.js';

// Half-typed form values live here rather than in game state, so a redraw
// (triggered by any commit) does not wipe what the user is in the middle of.
const draft = {
  matchA: '', matchB: '', matchMinutes: 10, matchError: '',
  segName: '', segParticipants: new Set(), segMinutes: 5, segError: '',
};

export function renderBooking(state, navigate) {
  const { show, broadcast } = state;
  const locked = isLive(broadcast);

  return el('section', {},
    el('h2', { text: `Booking — ${show.name}` }),
    locked ? liveNotice(navigate) : null,
    totals(show),
    isOverbooked(show)
      ? el('div', {
          class: 'notice warn',
          text: `Overbooked by ${bookedMinutes(show) - show.runtimeMinutes} minutes. You can still run this card.`,
        })
      : null,
    cardTable(state, show, locked),
    locked ? null : addMatchPanel(state),
    locked ? null : addSegmentPanel(state),
    el('div', {},
      el('button', {
        type: 'button',
        class: 'btn primary',
        text: 'Start Show',
        disabled: locked || show.items.length === 0,
        onClick: () => {
          commit(s => { s.broadcast = createBroadcast(s.show); });
          navigate('live');
        },
      }),
      show.items.length === 0
        ? el('span', { class: 'muted', text: '  Add at least one item to start the show.' })
        : null
    )
  );
}

function liveNotice(navigate) {
  return el('div', { class: 'notice' },
    'A show is currently on the air, so the card is locked. ',
    el('button', { type: 'button', class: 'link', text: 'Go to the live show', onClick: () => navigate('live') })
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
