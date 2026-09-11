// The year. What happened, what is planned, and what is coming.
import { el } from './dom.js';
import { commit, notify } from '../store.js';
import { nameOf, byId } from '../model/wrestlers.js';
import { MATCH_TYPES, matchType, DEFAULT_MATCH_TYPE } from '../data/match-types.js';
import {
  horizonWeeks, scheduledFor, scheduleMatch, unschedule, setAdvertised, tellWrestler,
  isPpvWeek, showNameFor, runtimeForWeek,
} from '../model/calendar.js';
import { bookedMinutes } from '../model/show.js';
import { journalText } from './live.js';
import { wrestlerLink } from './links.js';

const draft = { a: '', b: '', typeId: DEFAULT_MATCH_TYPE, minutes: 12, week: 0, error: '' };

export function renderCalendar(state, navigate) {
  const weeks = horizonWeeks(state);
  if (!draft.week || !weeks.includes(draft.week)) draft.week = weeks[0];

  return el('section', {},
    el('h2', { text: 'Calendar' }),
    el('p', { class: 'muted', text: 'A planned match is a note to yourself. Advertising it tells the audience, and telling a wrestler tells them. Both are your word.' }),

    el('h3', { text: 'This week' }),
    el('div', { class: 'week now' },
      el('div', { class: 'week-id' },
        el('div', { class: 'week-name' },
          `Week ${state.week} — ${state.show.name}`,
          isPpvWeek(state.week) ? el('span', { class: 'chip chip-ppv', text: 'special' }) : null
        ),
        el('div', { class: 'week-meta', text: `${state.show.items.length} on the card · ${bookedMinutes(state.show)} of ${state.show.runtimeMinutes} minutes` })
      ),
      el('button', { type: 'button', class: 'btn', text: 'Go to booking', onClick: () => navigate('booking') })
    ),

    el('h3', { text: 'Coming up' }),
    scheduleForm(state, weeks),
    weeks.map(week => futureWeek(state, week)),

    el('h3', { text: `What happened (${(state.history || []).length})` }),
    (state.history || []).length
      ? (state.history || []).map(record => pastWeek(state, record))
      : el('p', { class: 'empty', text: 'Nothing yet. Run a show and it will be here.' })
  );
}

function scheduleForm(state, weeks) {
  const fit = state.wrestlers.filter(w => w.status === 'Available');
  const options = selected => [
    el('option', { value: '', text: '— choose —', selected: selected === '' }),
    ...fit.map(w => el('option', { value: w.id, selected: w.id === selected, text: w.name })),
  ];

  return el('div', { class: 'panel' },
    el('h3', { text: 'Plan a match' }),
    el('div', { class: 'row' },
      el('div', { class: 'field' },
        el('label', { text: 'Wrestler A' }),
        el('select', { onChange: e => { draft.a = e.target.value; } }, options(draft.a))
      ),
      el('div', { class: 'field' },
        el('label', { text: 'Wrestler B' }),
        el('select', { onChange: e => { draft.b = e.target.value; } }, options(draft.b))
      ),
      el('div', { class: 'field' },
        el('label', { text: 'Stipulation' }),
        el('select', { onChange: e => { draft.typeId = e.target.value; } },
          MATCH_TYPES.map(t => el('option', { value: t.id, selected: t.id === draft.typeId, text: t.name })))
      ),
      el('div', { class: 'field' },
        el('label', { text: 'Minutes' }),
        el('input', { type: 'number', min: '1', value: draft.minutes, onChange: e => { draft.minutes = e.target.value; } })
      ),
      el('div', { class: 'field' },
        el('label', { text: 'Week' }),
        el('select', { onChange: e => { draft.week = Number(e.target.value); } },
          weeks.map(week => el('option', {
            value: String(week), selected: week === draft.week,
            text: isPpvWeek(week) ? `Week ${week} — ${showNameFor(state, week)}` : `Week ${week}`,
          })))
      ),
      el('button', { type: 'button', class: 'btn', text: 'Plan it', onClick: () => addPlan(state) })
    ),
    draft.error ? el('p', { class: 'over', text: draft.error }) : null
  );
}

function addPlan(state) {
  if (!draft.a || !draft.b) { draft.error = 'Choose both wrestlers.'; return bump(); }
  if (draft.a === draft.b) { draft.error = 'A wrestler cannot face themselves.'; return bump(); }

  const plan = {
    week: draft.week,
    wrestlerAId: draft.a,
    wrestlerBId: draft.b,
    matchTypeId: draft.typeId,
    plannedMinutes: Number(draft.minutes),
  };
  draft.a = '';
  draft.b = '';
  draft.error = '';
  commit(s => scheduleMatch(s, plan));
  return null;
}

// Validation messages are interface state, so redraw without writing a save.
function bump() {
  notify();
  return null;
}

function futureWeek(state, week) {
  const planned = scheduledFor(state, week);
  const ppv = isPpvWeek(week);

  return el('div', { class: ppv ? 'week ppv' : 'week' },
    el('div', { class: 'week-id' },
      el('div', { class: 'week-name' },
        `Week ${week} — ${showNameFor(state, week)}`,
        ppv ? el('span', { class: 'chip chip-ppv', text: 'special' }) : null
      ),
      el('div', { class: 'week-meta', text: `${runtimeForWeek(state, week)} minutes · ${planned.length} planned` }),
      planned.length
        ? el('ul', { class: 'plans' }, planned.map(entry => plannedItem(state, entry)))
        : el('p', { class: 'empty', text: 'Nothing planned.' })
    )
  );
}

function plannedItem(state, entry) {
  const [a, b] = entry.participants;

  return el('li', { class: entry.advertised ? 'plan advertised' : 'plan' },
    el('div', { class: 'plan-id' },
      el('div', { class: 'plan-pair' },
        wrestlerLink(state, a), ' vs. ', wrestlerLink(state, b),
        entry.advertised
          ? el('span', { class: 'chip chip-ad', text: 'advertised' })
          : el('span', { class: 'chip', text: 'planned' })
      ),
      el('div', { class: 'plan-meta', text: `${matchType(entry.matchType).name} · ${entry.plannedMinutes} min${entry.told.length ? ` · told ${entry.told.map(id => nameOf(state.wrestlers, id)).join(' and ')}` : ''}` })
    ),
    el('div', { class: 'save-actions' },
      el('button', {
        type: 'button', class: entry.advertised ? 'btn' : 'btn primary',
        text: entry.advertised ? 'Unadvertise' : 'Advertise',
        onClick: () => commit(s => setAdvertised(s, entry.id, !entry.advertised)),
      }),
      ...entry.participants
        .filter(id => !entry.told.includes(id))
        .map(id => el('button', {
          type: 'button', class: 'btn small',
          text: `Tell ${shortName(byId(state.wrestlers, id))}`,
          onClick: () => commit(s => tellWrestler(s, entry.id, id)),
        })),
      el('button', {
        type: 'button', class: entry.advertised || entry.told.length ? 'btn danger' : 'btn',
        text: 'Drop',
        onClick: () => commit(s => unschedule(s, entry.id)),
      })
    )
  );
}

function shortName(wrestler) {
  if (!wrestler) return 'them';
  const parts = wrestler.name.split(' ');
  return parts.length > 1 ? parts[parts.length - 1] : wrestler.name;
}

function pastWeek(state, record) {
  const aired = new Map(record.results.map(r => [r.itemId, r]));

  return el('details', { class: record.ppv ? 'past ppv' : 'past' },
    el('summary', {},
      el('span', { class: 'past-name' }, `Week ${record.week} — ${record.name}`,
        record.ppv ? el('span', { class: 'chip chip-ppv', text: 'special' }) : null),
      el('span', { class: 'past-meta', text: `${record.results.length} aired · ${record.runtimeMinutes} min` }),
      record.grade ? el('span', { class: `grade-pill grade-${record.grade}`, text: record.grade }) : null
    ),
    el('table', {},
      el('thead', {}, el('tr', {},
        el('th', { class: 'num', text: 'Pos' }),
        el('th', { text: 'Item' }),
        el('th', { text: 'Winner' }),
        el('th', { class: 'num', text: 'Aired' })
      )),
      el('tbody', {}, record.items.map((item, index) => {
        const result = aired.get(item.id);
        return el('tr', { class: result ? '' : 'pulled' },
          el('td', { class: 'num', text: index + 1 }),
          el('td', {},
            item.type === 'match'
              ? [wrestlerLink(state, item.participants[0]), ' vs. ', wrestlerLink(state, item.participants[1])]
              : (item.name || '(segment)'),
            item.advertised ? el('span', { class: 'chip chip-ad', text: 'ad' }) : null
          ),
          el('td', {}, result && result.winnerId
            ? wrestlerLink(state, result.winnerId)
            : el('span', { class: 'muted', text: result ? '—' : 'did not air' })),
          el('td', { class: 'num', text: result ? `${result.actualMinutes} min` : '—' })
        );
      }))
    ),
    record.journal.length
      ? el('ul', { class: 'journal' }, record.journal.map(entry =>
          el('li', {},
            el('span', { class: 'at', text: `${entry.at} min` }),
            journalText(state, entry, record.items)
          )))
      : el('p', { class: 'empty', text: 'Nothing worth writing down.' })
  );
}
