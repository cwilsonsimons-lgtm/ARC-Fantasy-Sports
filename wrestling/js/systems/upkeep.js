// Between-show upkeep.
//
// The only thing that happens to the roster when nobody is watching, at Tier 1:
// people get their wind back. A wrestler who worked twenty minutes on Tuesday
// is not the same wrestler on the following Tuesday, and that is what makes
// booking the same person every week cost something.

import * as store from '../core/store.js';
import { EVENT_TYPES } from '../core/events.js';

/** Condition recovered per day. Durable wrestlers bounce back faster. */
export function recoveryPerDay(wrestler) {
  return 4 + wrestler.ability.durability / 25;
}

export function install() {
  store.on(EVENT_TYPES.CALENDAR_ADVANCED, (event) => {
    const days = event.data.days;
    if (!days) return;

    const recovered = [];
    for (const w of store.allWrestlers()) {
      if (w.state.condition >= 100) continue;
      const before = w.state.condition;
      const next = Math.min(100, before + recoveryPerDay(w) * days);
      // Silent: one line in the log for the whole roster, not fourteen.
      store.updateWrestlerState(w.id, { condition: next }, { silent: true });
      recovered.push({ id: w.id, from: Math.round(before), to: Math.round(next) });
    }
    if (!recovered.length) return;

    store.emit(EVENT_TYPES.WRESTLER_STATE, {
      summary: `${recovered.length} wrestler${recovered.length === 1 ? '' : 's'} recovered over ${days} day${days === 1 ? '' : 's'}`,
      subjects: recovered.map((r) => r.id),
      cause: event.id,
      data: { kind: 'condition_recovery', days, recovered },
    });
  });
}
