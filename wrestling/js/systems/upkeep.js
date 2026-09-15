// Between-show upkeep.
//
// The only thing that happens to the roster when nobody is watching, at Tier 1:
// people get their wind back. A wrestler who worked twenty minutes on Tuesday
// is not the same wrestler on the following Tuesday, and that is what makes
// booking the same person every week cost something.

import * as store from '../core/store.js';
import { EVENT_TYPES } from '../core/events.js';
import { moraleTarget } from './satisfaction.js';

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

/**
 * How fast morale moves toward what a wrestler's situation actually justifies.
 *
 * Events still knock morale about in the moment - losing a title hurts the
 * night it happens - but left alone it converges on their real satisfaction.
 * That way morale has a cause you can point at rather than being a number that
 * drifts wherever the last few events pushed it.
 */
export const MORALE_SETTLING_PER_DAY = 1.2;

/**
 * How fast a wrestler's view of the GM drifts back toward neutral.
 *
 * Deliberately slow - about a point a week. Without it trust and respect only
 * ever fall, so a GM who has a bad month can never recover anybody's faith and
 * the number sticks at zero where it stops carrying information. With it,
 * sustained neglect still craters somebody, but stopping the neglect is worth
 * something.
 */
export const GM_TIE_RECOVERY_PER_DAY = 0.15;
export const GM_TIE_NEUTRAL = 50;

function driftToward(value, target, amount) {
  if (value === target) return value;
  const step = Math.min(Math.abs(target - value), amount);
  return value + Math.sign(target - value) * step;
}

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
      // Faith in the office heals slowly on its own.
      const heal = GM_TIE_RECOVERY_PER_DAY * days;
      w.ties.gm.trust = Math.round(driftToward(w.ties.gm.trust, GM_TIE_NEUTRAL, heal));
      w.ties.gm.respect = Math.round(driftToward(w.ties.gm.respect, GM_TIE_NEUTRAL, heal));

      const target = moraleTarget(w.id);
      if (Math.abs(target - w.state.morale) > 1) {
        const step = Math.min(Math.abs(target - w.state.morale), MORALE_SETTLING_PER_DAY * days);
        patch.morale = w.state.morale + Math.sign(target - w.state.morale) * step;
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
