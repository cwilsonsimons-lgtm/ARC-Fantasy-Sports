// Operations that span the whole game state — the weekly phase machine.
//
//   prep   book the card for this week's show
//   live   the show is on the air
//   after  the show is over; review it, then advance to next week
//
// Phase is stored rather than derived from whether a broadcast exists, so a
// future phase (the week between shows) slots in without every screen having
// to re-derive where it is. The transitions below are the only places phase
// changes, which keeps the machine in one readable file.
import { seedRoster } from '../data/roster-seed.js';
import { createShow } from './show.js';
import { createBroadcast, completeCurrent, currentItem, elapsedMinutes } from './broadcast.js';
import { createEntry } from './journal.js';

export const PHASES = { PREP: 'prep', LIVE: 'live', AFTER: 'after' };

export function createGame() {
  return {
    week: 1,
    phase: PHASES.PREP,
    wrestlers: seedRoster(),
    show: createShow({ name: 'Weekly Show' }),
    broadcast: null,
    journal: [],
  };
}

// The card is only editable while preparing. During the show and afterwards it
// is the record of what was planned, so nothing may rewrite it.
export function canEditCard(state) {
  return state.phase === PHASES.PREP;
}

export function startShow(state) {
  if (state.phase !== PHASES.PREP || !state.show.items.length) return false;
  state.broadcast = createBroadcast(state.show);
  state.journal = [createEntry({ week: state.week, at: 0, type: 'show-start' })];
  state.phase = PHASES.LIVE;
  return true;
}

export function completeSegment(state) {
  if (state.phase !== PHASES.LIVE) return null;

  const item = currentItem(state.show, state.broadcast);
  if (!item) return null;

  const result = completeCurrent(state.show, state.broadcast);
  const at = elapsedMinutes(state.broadcast);

  state.journal.push(createEntry({
    week: state.week,
    at,
    type: 'segment-complete',
    itemId: item.id,
    data: { plannedMinutes: item.plannedMinutes, actualMinutes: result.actualMinutes },
  }));

  if (state.broadcast.status === 'complete') {
    state.journal.push(createEntry({ week: state.week, at, type: 'show-end' }));
    state.phase = PHASES.AFTER;
  }
  return result;
}

// The journal is deliberately per-show: it is cleared when the next show goes
// on the air, not here, so last week's record is still readable while the new
// card is being built. Memory that has to survive across weeks belongs on the
// wrestlers themselves, not in here.
export function advanceWeek(state) {
  if (state.phase !== PHASES.AFTER) return false;
  state.week += 1;
  state.show = createShow({ name: 'Weekly Show' });
  state.broadcast = null;
  state.phase = PHASES.PREP;
  return true;
}
