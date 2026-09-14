// The calendar and date system.
//
// Game time is a single integer: `day`, counted from day 0 of the save. Every
// dated thing in the game - a show, a memory, a contract expiry, an injury
// return, a promise deadline - stores that integer. One number keeps
// comparisons trivial ("is this memory older than that one") and keeps the save
// free of parsed date strings.
//
// A real calendar date is *derived* for display only. Nothing should ever store
// the formatted string.
//
// This module is pure: it does date maths and generates schedules, and takes
// the calendar object as an argument. store.js owns that object and owns
// advancing it, because advancing time emits events.

export const MS_PER_DAY = 86400000;

/** Weekly TV on this weekday. 2 = Tuesday, matching the format the design assumes. */
export const TV_WEEKDAY = 2;

/**
 * The schedule shape from the design foundation: three weeks of television,
 * then a premium live event in the fourth week. One block is a "month".
 */
export const BLOCK_WEEKS = 4;
export const PLE_WEEK_OF_BLOCK = 4;

export const SHOW_KINDS = Object.freeze({ TV: 'tv', PLE: 'ple' });

/** Default broadcast budgets, in seconds. A PLE is a longer night. */
export const DEFAULT_BUDGET_SEC = Object.freeze({
  [SHOW_KINDS.TV]: 60 * 60,
  [SHOW_KINDS.PLE]: 150 * 60,
});

export function createCalendar(startDate = '2026-01-05') {
  return {
    startDate,   // ISO date of day 0
    day: 0,      // current game day
    entries: [], // scheduled calendar entries, ascending by day
  };
}

// --- derivations -----------------------------------------------------------

/** Real Date for a game day. Display only. */
export function dateOf(calendar, day = calendar.day) {
  return new Date(Date.parse(`${calendar.startDate}T00:00:00Z`) + day * MS_PER_DAY);
}

export function isoOf(calendar, day = calendar.day) {
  return dateOf(calendar, day).toISOString().slice(0, 10);
}

/** 1-based week number since day 0. */
export function weekOf(day) {
  return Math.floor(day / 7) + 1;
}

/** 1-based block ("month") number since day 0. */
export function blockOf(day) {
  return Math.floor(day / (7 * BLOCK_WEEKS)) + 1;
}

/** 1-based week within its block, 1..BLOCK_WEEKS. */
export function weekInBlock(day) {
  return ((weekOf(day) - 1) % BLOCK_WEEKS) + 1;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function weekdayOf(calendar, day = calendar.day) {
  return dateOf(calendar, day).getUTCDay();
}

/** "Tue 6 Jan 2026" */
export function formatDate(calendar, day = calendar.day) {
  const d = dateOf(calendar, day);
  return `${WEEKDAY_NAMES[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "Month 2, Week 3" - how the game talks about time internally. */
export function formatGameTime(day) {
  return `Month ${blockOf(day)}, Week ${weekInBlock(day)}`;
}

// --- schedule generation ---------------------------------------------------

/**
 * The day of the TV show in a given 1-based week.
 * Day 0 is the start of week 1; the show lands on the first TV_WEEKDAY at or
 * after that week's first day.
 */
export function tvDayForWeek(calendar, week) {
  const weekStart = (week - 1) * 7;
  const startWeekday = weekdayOf(calendar, weekStart);
  const offset = (TV_WEEKDAY - startWeekday + 7) % 7;
  return weekStart + offset;
}

/** A PLE sits on the Sunday at the end of its block's final week. */
export function pleDayForBlock(calendar, block) {
  const finalWeek = (block - 1) * BLOCK_WEEKS + PLE_WEEK_OF_BLOCK;
  const weekStart = (finalWeek - 1) * 7;
  const startWeekday = weekdayOf(calendar, weekStart);
  const offset = (0 - startWeekday + 7) % 7; // 0 = Sunday
  return weekStart + (offset === 0 ? 7 : offset);
}

/**
 * Plan the dates and kinds for `blocks` months of programming.
 * Returns plain descriptors; store.js turns them into calendar entries with
 * IDs and shows, because that is a mutation and has to emit events.
 */
export function planSchedule(calendar, blocks = 3, { startBlock = 1 } = {}) {
  const planned = [];
  for (let b = startBlock; b < startBlock + blocks; b++) {
    for (let w = 1; w <= BLOCK_WEEKS; w++) {
      const week = (b - 1) * BLOCK_WEEKS + w;
      if (w === PLE_WEEK_OF_BLOCK) {
        planned.push({
          day: pleDayForBlock(calendar, b),
          kind: SHOW_KINDS.PLE,
          label: `Premium Live Event ${b}`,
          block: b,
          week,
        });
      } else {
        planned.push({
          day: tvDayForWeek(calendar, week),
          kind: SHOW_KINDS.TV,
          label: `Weekly TV, Week ${week}`,
          block: b,
          week,
        });
      }
    }
  }
  return planned.sort((a, b) => a.day - b.day);
}

// --- entry lookups ---------------------------------------------------------

export function entriesOn(calendar, day) {
  return calendar.entries.filter((e) => e.day === day);
}

export function entriesBetween(calendar, from, to) {
  return calendar.entries.filter((e) => e.day >= from && e.day <= to);
}

/** The next entry strictly after `day`, or null. */
export function nextEntry(calendar, day = calendar.day) {
  return calendar.entries.find((e) => e.day > day) || null;
}

/** The next entry at or after `day`, or null. */
export function upcomingEntry(calendar, day = calendar.day) {
  return calendar.entries.find((e) => e.day >= day) || null;
}

export function daysUntil(calendar, day) {
  return day - calendar.day;
}
