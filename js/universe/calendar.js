// WWE 2K Universe — the calendar.
//
// Two questions, one module:
//
//   "What day is what?"   Every brand carries a weekly show day (`day: 'Monday'`
//                         on the brand record), so the week fills itself in from
//                         the pyramid. Nothing here knows that Raw is a Monday —
//                         create a Saturday show called WCW and Saturdays light
//                         up.
//
//   "What happened?"      Every saved card sits on its date, and `cardOf` reads
//                         the night back: the segments in the order they were
//                         typed, and what they changed — belts, brands, injuries,
//                         alliances.
//
// Dates are ISO strings throughout and every conversion goes through UTC, so a
// user west of Greenwich does not see a show slide onto the previous day.

import { plural } from './util.js';

const MS_DAY = 86400000;

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const pad = n => String(n).padStart(2, '0');
const utc = iso => new Date(`${iso}T00:00:00Z`);
const isoOf = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export const weekdayOf = iso => utc(iso).getUTCDay();
export const weekdayName = iso => WEEKDAYS[weekdayOf(iso)];
export const monthKey = iso => iso.slice(0, 7);
export const shiftDays = (iso, n) => isoOf(new Date(utc(iso).getTime() + n * MS_DAY));

export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function shiftMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

// ------------------------------------------------------------------ the week

// Which brands run on a given weekday. This is the whole "what days are shows
// on" feature: it is a read of the brand records, so it follows whatever the
// user set up on the Pyramid tab.
export function brandsOnWeekday(state, weekday) {
  const name = typeof weekday === 'number' ? WEEKDAYS[weekday] : weekday;
  return Object.values(state.brands)
    .filter(b => b.day === name)
    .sort((a, b) => (a.tier || 1) - (b.tier || 1) || a.name.localeCompare(b.name));
}

// The weekly schedule as a table: seven rows, whoever runs that night.
export function weeklySchedule(state) {
  return WEEKDAYS.map((name, i) => ({
    weekday: name, index: i,
    brands: brandsOnWeekday(state, i).map(b => ({
      id: b.id, name: b.name, color: b.color || null, tier: b.tier || 1,
    })),
  }));
}

// ------------------------------------------------------------------ the month

const showCell = (state, s) => ({
  id: s.id, name: s.name, date: s.date, ple: s.ple || null,
  brandId: s.brandId || null,
  brandName: s.brandId && state.brands[s.brandId] ? state.brands[s.brandId].name : null,
  color: (s.brandId && state.brands[s.brandId] && state.brands[s.brandId].color) || null,
  segments: s.segments.length,
  matches: s.segments.filter(g => g.type === 'match').length,
});

export function showsOn(state, date) {
  return state.shows.filter(s => s.date === date).map(s => showCell(state, s));
}

// A month as six weeks of cells. Days from the months either side are included
// and marked `inMonth: false`, so the grid is always rectangular.
export function calendarMonth(state, key, { weekStart = 0 } = {}) {
  const [year, month] = key.split('-').map(Number);
  const first = `${year}-${pad(month)}-01`;
  const lead = (weekdayOf(first) - weekStart + 7) % 7;
  const start = shiftDays(first, -lead);
  const today = state.asOf;

  const weeks = [];
  let cursor = start;
  for (let w = 0; w < 6; w++) {
    const row = [];
    for (let d = 0; d < 7; d++) {
      const shows = showsOn(state, cursor);
      // A brand that ran a card that night is not also "scheduled" — the card
      // is what happened, and showing both would double every Monday.
      const booked = new Set(shows.map(s => s.brandId));
      row.push({
        date: cursor,
        dayNum: Number(cursor.slice(8)),
        weekday: weekdayName(cursor),
        inMonth: monthKey(cursor) === key,
        isToday: cursor === today,
        past: cursor < today,
        shows,
        scheduled: brandsOnWeekday(state, weekdayOf(cursor))
          .filter(b => !booked.has(b.id))
          .map(b => ({ id: b.id, name: b.name, color: b.color || null })),
        ples: shows.filter(s => s.ple).map(s => s.ple),
      });
      cursor = shiftDays(cursor, 1);
    }
    weeks.push(row);
    // Five weeks is enough for most months; stop early rather than trailing a
    // whole row of greyed-out days.
    if (monthKey(cursor) !== key && w >= 4) break;
  }

  const shows = state.shows.filter(s => monthKey(s.date) === key).map(s => showCell(state, s));
  return {
    key, year, month, label: monthLabel(key),
    prev: shiftMonths(key, -1), next: shiftMonths(key, 1),
    weekdayNames: WEEKDAYS.map((_, i) => WEEKDAYS[(i + weekStart) % 7]),
    weeks, shows,
    counts: {
      shows: shows.length,
      matches: shows.reduce((n, s) => n + s.matches, 0),
      ples: shows.filter(s => s.ple).length,
    },
  };
}

// Every month that has a card in it, newest first — the index you scroll when
// you want to look back and cannot remember when something happened.
export function monthsWithShows(state) {
  const by = new Map();
  state.shows.forEach(s => {
    const k = monthKey(s.date);
    if (!by.has(k)) by.set(k, { key: k, label: monthLabel(k), shows: 0, matches: 0, ples: [] });
    const row = by.get(k);
    row.shows += 1;
    row.matches += s.segments.filter(g => g.type === 'match').length;
    if (s.ple) row.ples.push(s.name);
  });
  return [...by.values()].sort((a, b) => b.key.localeCompare(a.key));
}

// ------------------------------------------------------------------ one card

const nameOf = (state, ref) => (state.wrestlers[ref] ? state.wrestlers[ref].name
  : state.groups[ref] ? state.groups[ref].name
  : state.championships[ref] ? state.championships[ref].name : ref);

// What a night changed, read off the effects rather than re-derived — so it is
// exactly what the log did, and a voided match drops out of it.
function changesOn(state, events) {
  const out = [];
  const add = (kind, text, eventId) => out.push({ kind, text, eventId });

  events.forEach(e => (e.effects || []).forEach(fx => {
    const belt = fx.titleId && state.championships[fx.titleId] ? state.championships[fx.titleId].name : fx.titleId;
    const who = list => (list || []).map(r => nameOf(state, r)).join(' & ');

    if (fx.kind === 'title.award') add('title', `${belt} — new champion: ${who(fx.holders)}`, e.id);
    else if (fx.kind === 'title.interim') add('title', `${belt} — interim champion: ${who(fx.holders)}`, e.id);
    else if (fx.kind === 'title.unify') add('title', `${belt} unified — ${who(fx.holders)}`, e.id);
    else if (fx.kind === 'title.vacate') add('title', `${belt} vacated (${fx.reason || 'vacated'})`, e.id);
    else if (fx.kind === 'roster.brand') {
      const to = state.brands[fx.brandId] ? state.brands[fx.brandId].name : fx.brandId;
      add('roster', `${nameOf(state, fx.subject)} moves to ${to}${fx.reason ? ` (${fx.reason})` : ''}`, e.id);
    } else if (fx.kind === 'injury.start') {
      add('injury', `${nameOf(state, fx.subject)} injured${fx.weeks ? ` — ${fx.weeks} weeks` : ''}`, e.id);
    } else if (fx.kind === 'injury.end') add('injury', `${nameOf(state, fx.subject)} cleared to return`, e.id);
    else if (fx.kind === 'group.form') {
      add('group', `${fx.name || (state.groups[fx.groupId] ? state.groups[fx.groupId].name : 'a new group')} forms`, e.id);
    }
    else if (fx.kind === 'group.dissolve') {
      add('group', `${state.groups[fx.groupId] ? state.groups[fx.groupId].name : fx.groupId} splits up`, e.id);
    }
  }));
  return out;
}

// One night, in full: the card in the order it was typed, and what it changed.
export function cardOf(state, showId) {
  const show = state.showsById[showId];
  if (!show) return null;
  const events = state.events.filter(e => e.showId === showId);
  const idx = state.shows.findIndex(s => s.id === showId);

  return {
    ...show,
    weekday: weekdayName(show.date),
    brandName: show.brandId && state.brands[show.brandId] ? state.brands[show.brandId].name : null,
    color: (show.brandId && state.brands[show.brandId] && state.brands[show.brandId].color) || null,
    matches: show.segments.filter(g => g.type === 'match').length,
    changes: changesOn(state, events),
    // Chronological neighbours, so a card can be paged through like a diary.
    prev: idx > 0 ? state.shows[idx - 1].id : null,
    next: idx >= 0 && idx < state.shows.length - 1 ? state.shows[idx + 1].id : null,
  };
}

// Plain text, for the CLI and for pasting somewhere. Same content as the page.
export function cardText(state, showId) {
  const card = cardOf(state, showId);
  if (!card) return '';
  const lines = [`${card.name} — ${card.weekday} ${card.date}${card.brandName ? ` — ${card.brandName}` : ''}`];
  card.segments.forEach(g => lines.push(`  ${g.order ? `${g.order}. ` : '   '}${g.text}`));
  if (card.changes.length) {
    lines.push('', '  What changed:');
    card.changes.forEach(c => lines.push(`    · ${c.text}`));
  }
  return lines.join('\n');
}

// A month as text, for the CLI: one row a week, a column a day.
export function monthText(state, key, { width = 15 } = {}) {
  const m = calendarMonth(state, key);
  const cell = s => (s.length > width ? `${s.slice(0, width - 1)}…` : s).padEnd(width);
  const lines = [`${m.label}`, m.weekdayNames.map(d => cell(d.slice(0, 3))).join('')];

  m.weeks.forEach(week => {
    lines.push(week.map(d => cell(`${d.inMonth ? '' : '·'}${d.dayNum}${d.isToday ? ' *' : ''}`)).join('').trimEnd());
    // Up to three lines under each row: whatever ran, then whatever was due.
    const depth = Math.max(...week.map(d => d.shows.length + d.scheduled.length), 0);
    for (let i = 0; i < Math.min(depth, 3); i++) {
      lines.push(week.map(d => {
        const both = [...d.shows.map(s => `${s.ple ? '★ ' : ''}${s.name}`), ...d.scheduled.map(b => `(${b.name})`)];
        return cell(both[i] ? `  ${both[i]}` : '');
      }).join('').trimEnd());
    }
    lines.push('');
  });

  lines.push(`${plural(m.counts.shows, 'show')} · ${plural(m.counts.matches, 'match', 'matches')}`
    + `${m.counts.ples ? ` · ${plural(m.counts.ples, 'PLE')}` : ''}`);
  return lines.join('\n');
}
