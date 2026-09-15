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

/**
 * Momentum drains toward neutral per day.
 *
 * Without this a win streak is permanent and a wrestler left off television for
 * a month is as hot as the night they last won. Fading it is what makes a push
 * something the GM has to keep feeding.
 */
export const MOMENTUM_DECAY_PER_DAY = 1.5;

/**
 * Hostility cools per day when a feud is not being fed.
 *
 * Without this, heat only ever accumulates and every pair on the roster ends up
 * a blood feud by month six. With it, a rivalry has to be kept alive by
 * booking, which is the correct thing for the GM to have to do.
 */
export const HOSTILITY_COOLING_PER_DAY = 0.35;

export function decayMomentum(momentum, days) {
  const drop = MOMENTUM_DECAY_PER_DAY * days;
  if (momentum > 0) return Math.max(0, momentum - drop);
  if (momentum < 0) return Math.min(0, momentum + drop);
  return 0;
}

export function install() {
  store.on(EVENT_TYPES.CALENDAR_ADVANCED, (event) => {
    const days = event.data.days;
    if (!days) return;

    const recovered = [];
    const cooled = [];
    let feudsCooled = 0;
    for (const w of store.allWrestlers()) {
      // Heat fades between meetings. Written straight to the relationship: this
      // is weather, not an event, and nothing should react to it.
      for (const rel of Object.values(w.ties.relationships)) {
        if (rel.hostility <= 0) continue;
        const next = Math.max(0, rel.hostility - HOSTILITY_COOLING_PER_DAY * days);
        if (next !== rel.hostility) { rel.hostility = Math.round(next); feudsCooled++; }
      }

      const patch = {};
      if (w.state.condition < 100) {
        const next = Math.min(100, w.state.condition + recoveryPerDay(w) * days);
        patch.condition = next;
        recovered.push({ id: w.id, from: Math.round(w.state.condition), to: Math.round(next) });
      }
      if (w.state.momentum !== 0) {
        const next = decayMomentum(w.state.momentum, days);
        patch.momentum = next;
        cooled.push({ id: w.id, from: Math.round(w.state.momentum), to: Math.round(next) });
      }
      // Silent: one line in the log for the whole roster, not fourteen.
      if (Object.keys(patch).length) store.updateWrestlerState(w.id, patch, { silent: true });
    }
    if (!recovered.length && !cooled.length && !feudsCooled) return;

    store.emit(EVENT_TYPES.WRESTLER_STATE, {
      summary: `${recovered.length} rested, ${cooled.length} cooled off, ${feudsCooled} rivalries lost heat over ${days} day${days === 1 ? '' : 's'}`,
      subjects: [...new Set([...recovered.map((r) => r.id), ...cooled.map((c) => c.id)])],
      cause: event.id,
      data: { kind: 'condition_recovery', days, recovered, cooled, feudsCooled },
    });
  });
}
