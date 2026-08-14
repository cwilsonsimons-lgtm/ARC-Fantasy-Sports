// WWE 2K Universe — the calendar.
//
// The universe does not run on real-world months. It runs on a repeating
// 28-day cycle: four weeks of seven days, days 1 to 28, and that is the whole
// structure. Week 1 is days 1-7, week 4 is days 22-28, and there is no
// February.
//
// Underneath, events still carry real ISO dates — reign day counts, rivalry
// decay and "state as of" all need a real timeline, and inventing a second one
// would mean two clocks to keep in step. So the cycle is a *lens*: an anchor
// date is day 1 of cycle 1, and every date maps to (cycle, day). Cards you have
// already played land on the day they fall on; the schedule sits on the same
// grid.
//
// Two things live on that grid, and they are deliberately different kinds of
// thing:
//
//   WEEKLY SHOWS repeat. A brand runs on a slot inside the week (1-7), so a
//   show on slot 2 appears on days 2, 9, 16 and 23 of every cycle.
//
//   PLES are placed. One day, chosen by the user, moved whenever they like —
//   see ples.js. Nothing here forces one into a week or a day.

import { plural } from './util.js';
import { CYCLE_DAYS, WEEK_DAYS, CYCLE_WEEKS } from './schema.js';

const MS_DAY = 86400000;

export { CYCLE_DAYS, WEEK_DAYS, CYCLE_WEEKS };
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// The cycle's own week starts at day 1. Weekday names are only a convenience
// for a brand record that was written before slots existed.
export const SLOT_WEEKDAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const pad = n => String(n).padStart(2, '0');
const utc = iso => new Date(`${iso}T00:00:00Z`);
const isoOf = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export const shiftDays = (iso, n) => isoOf(new Date(utc(iso).getTime() + n * MS_DAY));
export const daysBetween = (a, b) => Math.round((utc(b).getTime() - utc(a).getTime()) / MS_DAY);
export const weekdayName = iso => WEEKDAYS[utc(iso).getUTCDay()];

export const weekOfDay = day => Math.floor((Number(day) - 1) / WEEK_DAYS) + 1;
export const slotOfDay = day => ((Number(day) - 1) % WEEK_DAYS) + 1;
export const dayLabel = day => `Day ${day} · week ${weekOfDay(day)}`;

// ------------------------------------------------------------------ the anchor

// Day 1 of cycle 1. Taken from the save if it has one, otherwise the first
// thing that ever happened — so an existing universe gets a sensible cycle
// without being asked, and a new one starts wherever it starts.
export function calendarStart(state) {
  const set = state.calendar && state.calendar.start;
  if (set) return set;
  if (state.startDate) return state.startDate;
  const first = state.events.length ? state.events[0].date : null;
  return first || state.asOf;
}

export function cycleOf(state, iso) {
  const n = daysBetween(calendarStart(state), iso);
  // Negative offsets floor towards -infinity so a date before the anchor lands
  // in an earlier cycle rather than folding onto day 1.
  const cycle = Math.floor(n / CYCLE_DAYS) + 1;
  const day = ((n % CYCLE_DAYS) + CYCLE_DAYS) % CYCLE_DAYS + 1;
  return { cycle, day, week: weekOfDay(day) };
}

export const dateOf = (state, cycle, day) =>
  shiftDays(calendarStart(state), (Number(cycle) - 1) * CYCLE_DAYS + (Number(day) - 1));

export const currentCycle = state => cycleOf(state, state.asOf).cycle;

// ------------------------------------------------------------------ the week

// Which slot a brand runs on. `slot` is the field going forward; a brand that
// only carries a weekday name still works, because that is what older saves and
// the seed file have.
export function slotOfBrand(brand) {
  if (!brand) return null;
  if (brand.slot != null && brand.slot !== '') return Number(brand.slot);
  const i = SLOT_WEEKDAY.indexOf(brand.day);
  return i < 0 ? null : i + 1;
}

export function brandsOnSlot(state, slot) {
  return Object.values(state.brands)
    .filter(b => slotOfBrand(b) === Number(slot))
    .sort((a, b) => (a.tier || 1) - (b.tier || 1) || a.name.localeCompare(b.name));
}

// The weekly pattern: seven rows, whoever runs that night.
export function weeklySchedule(state) {
  return Array.from({ length: WEEK_DAYS }, (_, i) => ({
    slot: i + 1,
    weekday: SLOT_WEEKDAY[i],
    brands: brandsOnSlot(state, i + 1).map(b => ({
      id: b.id, name: b.name, color: b.color || null, tier: b.tier || 1,
    })),
  }));
}

// ------------------------------------------------------------------ the cycle

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

// One cycle as four weeks of seven days. `brandId` filters the whole grid:
// weekly shows for that brand, PLEs that include it, cards it ran (§39).
export function cycleGrid(state, cycle, { brandId = null, ples = [] } = {}) {
  const n = Number(cycle);
  const today = cycleOf(state, state.asOf);

  const weeks = [];
  for (let w = 0; w < CYCLE_WEEKS; w++) {
    const row = [];
    for (let d = 1; d <= WEEK_DAYS; d++) {
      const day = w * WEEK_DAYS + d;
      const date = dateOf(state, n, day);
      const shows = showsOn(state, date);
      const onDay = ples.filter(p => p.day === day);
      const booked = new Set(shows.map(s => s.brandId));

      // A brand that ran a card that night is not also "due" — the card is
      // what happened, and showing both would double every week.
      const weekly = brandsOnSlot(state, slotOfDay(day))
        .filter(b => !booked.has(b.id))
        .map(b => ({ id: b.id, name: b.name, color: b.color || null }));

      const keep = p => !brandId || (p.brandIds || []).includes(brandId);
      const showKeep = s => !brandId || s.brandId === brandId
        || onDay.some(p => (p.brandIds || []).includes(brandId) && sameName(p.name, s.name));

      row.push({
        day, week: w + 1, slot: slotOfDay(day), date,
        weekday: weekdayName(date),
        isToday: today.cycle === n && today.day === day,
        past: date < state.asOf,
        shows: shows.filter(showKeep),
        weekly: brandId ? weekly.filter(b => b.id === brandId) : weekly,
        ples: onDay.filter(keep),
      });
    }
    weeks.push(row);
  }

  const flat = weeks.flat();
  return {
    cycle: n, weeks,
    from: dateOf(state, n, 1), to: dateOf(state, n, CYCLE_DAYS),
    isCurrent: today.cycle === n,
    counts: {
      shows: flat.reduce((t, c) => t + c.shows.length, 0),
      matches: flat.reduce((t, c) => t + c.shows.reduce((m, s) => m + s.matches, 0), 0),
      ples: flat.reduce((t, c) => t + c.ples.length, 0),
    },
  };
}

const sameName = (a, b) => String(a).toLowerCase().trim() === String(b).toLowerCase().trim();

// Every cycle that has a card in it, newest first — the index you scroll when
// you want to look back and cannot remember when something happened.
export function cyclesWithShows(state) {
  const by = new Map();
  state.shows.forEach(s => {
    const { cycle } = cycleOf(state, s.date);
    if (!by.has(cycle)) by.set(cycle, { cycle, shows: 0, matches: 0, ples: [] });
    const row = by.get(cycle);
    row.shows += 1;
    row.matches += s.segments.filter(g => g.type === 'match').length;
    if (s.ple) row.ples.push(s.name);
  });
  return [...by.values()].sort((a, b) => b.cycle - a.cycle);
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
    } else if (fx.kind === 'group.dissolve') {
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
  const at = cycleOf(state, show.date);

  return {
    ...show,
    cycle: at.cycle, day: at.day, week: at.week,
    dayLabel: dayLabel(at.day),
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
  const lines = [`${card.name} — cycle ${card.cycle}, day ${card.day} (${card.date})`
    + `${card.brandName ? ` — ${card.brandName}` : ''}`];
  card.segments.forEach(g => lines.push(`  ${g.order ? `${g.order}. ` : '   '}${g.text}`));
  if (card.changes.length) {
    lines.push('', '  What changed:');
    card.changes.forEach(c => lines.push(`    · ${c.text}`));
  }
  return lines.join('\n');
}

// A cycle as text, for the CLI: one block a week, a column a day.
export function cycleText(state, cycle, { width = 17, ples = [] } = {}) {
  const grid = cycleGrid(state, cycle, { ples });
  const cell = s => (s.length > width ? `${s.slice(0, width - 1)}…` : s).padEnd(width);
  const lines = [`Cycle ${grid.cycle}   ${grid.from} → ${grid.to}${grid.isCurrent ? '   (now)' : ''}`];

  grid.weeks.forEach((week, i) => {
    lines.push('', `Week ${i + 1}`);
    lines.push(week.map(d => cell(`Day ${d.day}${d.isToday ? ' *' : ''}`)).join('').trimEnd());
    const depth = Math.max(...week.map(d => d.shows.length + d.ples.length + d.weekly.length), 0);
    for (let r = 0; r < Math.min(depth, 4); r++) {
      lines.push(week.map(d => {
        const all = [
          ...d.ples.map(p => `★ ${p.name}${p.brandLine ? ` (${p.brandLine})` : ''}`),
          ...d.shows.map(s => s.name),
          ...d.weekly.map(b => `(${b.name})`),
        ];
        return cell(all[r] ? `  ${all[r]}` : '');
      }).join('').trimEnd());
    }
  });

  lines.push('', `${plural(grid.counts.ples, 'PLE')} · ${plural(grid.counts.shows, 'card')}`
    + ` · ${plural(grid.counts.matches, 'match', 'matches')}`);
  return lines.join('\n');
}
