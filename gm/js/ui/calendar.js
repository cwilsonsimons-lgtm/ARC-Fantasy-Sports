// The year, as a calendar.
//
// Weeks are integers underneath, but the player thinks in months and nights, so
// this draws a real grid and hangs the show on the night it airs. Clicking a
// show night opens it: a past one reads back what happened, a future one is
// where you plan, advertise, and quietly tell people.
import { el } from './dom.js';
import { commit, notify } from '../store.js';
import { nameOf, byId } from '../model/wrestlers.js';
import { MATCH_TYPES, matchType, DEFAULT_MATCH_TYPE } from '../data/match-types.js';
import {
  scheduledFor, scheduleMatch, unschedule, setAdvertised, tellWrestler,
  isPpvWeek, showNameFor, runtimeForWeek, dateForWeek, weekForDate, monthGrid,
  sameDay, MONTH_NAMES, WEEKDAY_NAMES,
} from '../model/calendar.js';
import { bookedMinutes } from '../model/show.js';
import { journalText } from './live.js';
import { wrestlerLink } from './links.js';

const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const draft = { a: '', b: '', typeId: DEFAULT_MATCH_TYPE, minutes: 12, error: '' };

let view = null;     // { year, month } currently on screen
let selected = null; // week number whose detail is open

function focusOn(state, week) {
  const date = dateForWeek(state, week);
  view = { year: date.getUTCFullYear(), month: date.getUTCMonth() };
  selected = week;
}

export function renderCalendar(state, navigate) {
  if (!view || selected === null) focusOn(state, state.week);

  return el('section', {},
    el('h2', { text: 'Calendar' }),
    el('p', { class: 'muted', text: `${showNameFor(state, state.week)} airs on ${WEEKDAY_NAMES[state.airNight]}s. A planned match is a note to yourself; advertising it tells the audience and telling a wrestler tells them.` }),
    monthView(state),
    detailPanel(state, navigate)
  );
}

function monthView(state) {
  const cells = monthGrid(view.year, view.month);
  const today = dateForWeek(state, state.week);

  return el('div', { class: 'cal' },
    el('div', { class: 'cal-head' },
      el('button', { type: 'button', class: 'btn small', text: '‹', title: 'Previous month', onClick: () => step(-1) }),
      el('span', { class: 'cal-title', text: `${MONTH_NAMES[view.month]} ${view.year}` }),
      el('button', { type: 'button', class: 'btn small', text: '›', title: 'Next month', onClick: () => step(1) }),
      el('button', { type: 'button', class: 'btn small', text: 'This week', onClick: () => { focusOn(state, state.week); notify(); } })
    ),
    el('div', { class: 'cal-grid' },
      DAY_INITIALS.map((initial, index) =>
        el('div', { class: 'cal-dow', title: WEEKDAY_NAMES[index], text: initial })
      ),
      cells.map(date => dayCell(state, date, today))
    )
  );
}

function step(months) {
  const next = new Date(Date.UTC(view.year, view.month + months, 1));
  view = { year: next.getUTCFullYear(), month: next.getUTCMonth() };
  notify();
}

function dayCell(state, date, today) {
  const inMonth = date.getUTCMonth() === view.month;
  const week = weekForDate(state, date);
  const classes = ['cal-day'];
  if (!inMonth) classes.push('outside');
  if (week) classes.push('airs');
  if (week && isPpvWeek(week)) classes.push('ppv');
  if (sameDay(date, today)) classes.push('now');
  if (week && week === selected) classes.push('picked');

  const label = el('span', { class: 'cal-num', text: String(date.getUTCDate()) });
  if (!week) return el('div', { class: classes.join(' ') }, label);

  return el('button', {
    type: 'button',
    class: classes.join(' '),
    onClick: () => { selected = week; notify(); },
  },
    label,
    el('span', { class: 'cal-show', text: showNameFor(state, week) }),
    cellStatus(state, week)
  );
}

function cellStatus(state, week) {
  if (week < state.week) {
    const record = historyFor(state, week);
    return record && record.grade
      ? el('span', { class: `cal-grade grade-${record.grade}`, text: record.grade })
      : el('span', { class: 'cal-note', text: 'aired' });
  }
  if (week === state.week) return el('span', { class: 'cal-note live', text: 'this week' });

  const planned = scheduledFor(state, week);
  if (!planned.length) return null;
  const ads = planned.filter(p => p.advertised).length;
  return el('span', { class: ads ? 'cal-note ad' : 'cal-note', text: ads ? `${planned.length} · ${ads} ad` : `${planned.length} planned` });
}

function historyFor(state, week) {
  return (state.history || []).find(record => record.week === week) || null;
}

// ---------- the night you clicked ----------

function detailPanel(state, navigate) {
  const week = selected;
  const date = dateForWeek(state, week);
  const stamp = `${WEEKDAY_NAMES[date.getUTCDay()]} ${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`;

  const header = el('div', { class: 'detail-head' },
    el('div', {},
      el('div', { class: 'detail-name' },
        `Week ${week} — ${showNameFor(state, week)}`,
        isPpvWeek(week) ? el('span', { class: 'chip chip-ppv', text: 'special' }) : null
      ),
      el('div', { class: 'detail-date', text: stamp })
    ),
    week === state.week
      ? el('button', { type: 'button', class: 'btn', text: 'Go to booking', onClick: () => navigate('booking') })
      : null
  );

  if (week < state.week) return el('div', { class: 'detail' }, header, pastDetail(state, week));
  if (week === state.week) return el('div', { class: 'detail now' }, header, currentDetail(state));
  return el('div', { class: 'detail' }, header, futureDetail(state, week));
}

function currentDetail(state) {
  return el('p', { class: 'detail-meta', text: `${state.show.items.length} on the card · ${bookedMinutes(state.show)} of ${state.show.runtimeMinutes} minutes booked.` });
}

function pastDetail(state, week) {
  const record = historyFor(state, week);
  if (!record) return el('p', { class: 'empty', text: 'Nothing was recorded for this one.' });

  const aired = new Map(record.results.map(r => [r.itemId, r]));

  return el('div', {},
    el('p', { class: 'detail-meta', text: `${record.results.length} aired · ${record.runtimeMinutes} minute window${record.grade ? ` · graded ${record.grade}` : ''}` }),
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

function futureDetail(state, week) {
  const planned = scheduledFor(state, week);

  return el('div', {},
    el('p', { class: 'detail-meta', text: `${runtimeForWeek(state, week)} minute window · ${planned.length} planned` }),
    planned.length
      ? el('ul', { class: 'plans' }, planned.map(entry => plannedItem(state, entry)))
      : el('p', { class: 'empty', text: 'Nothing planned for this one yet.' }),
    planForm(state, week)
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

function planForm(state, week) {
  const fit = state.wrestlers.filter(w => w.status === 'Available');
  const options = selectedId => [
    el('option', { value: '', text: '— choose —', selected: selectedId === '' }),
    ...fit.map(w => el('option', { value: w.id, selected: w.id === selectedId, text: w.name })),
  ];

  return el('div', { class: 'panel' },
    el('h3', { text: `Plan a match for week ${week}` }),
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
      el('button', { type: 'button', class: 'btn', text: 'Plan it', onClick: () => addPlan(week) })
    ),
    draft.error ? el('p', { class: 'over', text: draft.error }) : null
  );
}

function addPlan(week) {
  if (!draft.a || !draft.b) { draft.error = 'Choose both wrestlers.'; return notify(); }
  if (draft.a === draft.b) { draft.error = 'A wrestler cannot face themselves.'; return notify(); }

  const plan = {
    week,
    wrestlerAId: draft.a,
    wrestlerBId: draft.b,
    matchTypeId: draft.typeId,
    plannedMinutes: Number(draft.minutes),
  };
  draft.a = '';
  draft.b = '';
  draft.error = '';
  return commit(s => scheduleMatch(s, plan));
}
