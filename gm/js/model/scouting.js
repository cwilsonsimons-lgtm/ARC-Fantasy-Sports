// Finding out about people.
//
// Today this is only the half of the branch that points inward — asking around
// about somebody already on the roster. The outward half (an independent
// circuit, a talent pool, reports with accuracy, a developmental territory) is
// designed in docs/gm-progression.md and not built; when it arrives it belongs
// in here rather than beside it.
//
// Nothing in here invents a second way of knowing people. model/stats.js
// already turns familiarity into readings that sharpen over time, and a
// background check is a shortcut through that same door: you learn what a
// season of working together would have taught you, faster and without the
// season.
import { byId } from './wrestlers.js';
import { createEntry } from './journal.js';
import { has } from './progression.js';
import { BACKGROUND_CHECK_FAMILIARITY } from './unlocks.js';

// One a week, and the week it was used is remembered rather than a counter
// reset, so nothing has to run at the turn of the week to make it true again.
export function checkedThisWeek(state) {
  return (state.gmChecks || []).includes(state.week);
}

export function canCheck(state) {
  return has(state, 'background-check') && !checkedThisWeek(state);
}

// Returns what was learned, or null if there was nothing to buy — the caller
// prints it. A wrestler you already know well is a wasted week, and the game
// says so rather than silently spending it.
export function backgroundCheck(state, wrestlerId) {
  if (!canCheck(state)) return null;
  const wrestler = byId(state.wrestlers, wrestlerId);
  if (!wrestler) return null;

  const before = wrestler.familiarity || 0;
  wrestler.familiarity = Math.min(100, before + BACKGROUND_CHECK_FAMILIARITY);

  state.gmChecks = state.gmChecks || [];
  state.gmChecks.push(state.week);

  state.journal.push(createEntry({
    week: state.week,
    at: 0,
    type: 'background-check',
    data: { wrestlerId, from: Math.round(before), to: Math.round(wrestler.familiarity) },
  }));

  return { wrestler, from: before, to: wrestler.familiarity };
}
