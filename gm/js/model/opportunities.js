// What an incident could become.
//
// A backstage fight does not automatically become a feud and a booked match.
// It hands the GM something they may use, and leaving it on the table is itself
// a decision — an unbooked grievance goes stale, and the person who was wronged
// notices that nothing was ever done about it.
import { byId } from './wrestlers.js';
import { createEntry } from './journal.js';
import { nextId } from '../ids.js';

const SHELF_LIFE = 3; // weeks before the heat is gone

export function createOpportunity(state, { aggressorId, victimId, reason, promised = false }) {
  state.opportunities = state.opportunities || [];

  const existing = state.opportunities.find(o =>
    (o.aggressorId === aggressorId && o.victimId === victimId)
    || (o.aggressorId === victimId && o.victimId === aggressorId)
  );
  if (existing) {
    // The same two again. It does not stack, it just gets fresher and hotter.
    existing.week = state.week;
    existing.expiresWeek = state.week + SHELF_LIFE;
    existing.promised = existing.promised || promised;
    existing.repeats = (existing.repeats || 0) + 1;
    return existing;
  }

  const opportunity = {
    id: nextId('opp'),
    week: state.week,
    expiresWeek: state.week + SHELF_LIFE,
    aggressorId,
    victimId,
    reason,
    promised,
    repeats: 0,
  };
  state.opportunities.push(opportunity);
  return opportunity;
}

export function listOpportunities(state) {
  return (state.opportunities || []).filter(o => {
    const a = byId(state.wrestlers, o.aggressorId);
    const b = byId(state.wrestlers, o.victimId);
    return a && b && a.status === 'Available' && b.status === 'Available';
  });
}

export function takeOpportunity(state, id) {
  const opportunity = (state.opportunities || []).find(o => o.id === id);
  if (!opportunity) return null;
  state.opportunities = state.opportunities.filter(o => o.id !== id);
  return opportunity;
}

export function dismissOpportunity(state, id) {
  const opportunity = takeOpportunity(state, id);
  if (!opportunity) return null;
  // Waving it away in front of the person who wanted it is not free.
  const victim = byId(state.wrestlers, opportunity.victimId);
  if (victim) victim.morale = Math.max(0, victim.morale - 3);
  return opportunity;
}

// Called when the week turns. Anything nobody used goes cold, and a promise
// nobody kept goes worse than cold.
export function ageOpportunities(state) {
  const kept = [];
  for (const opportunity of state.opportunities || []) {
    if (state.week < opportunity.expiresWeek) {
      kept.push(opportunity);
      continue;
    }

    const victim = byId(state.wrestlers, opportunity.victimId);
    if (victim) {
      victim.morale = Math.max(0, victim.morale - (opportunity.promised ? 9 : 4));
      if (opportunity.promised && !victim.grudges.some(g => g.type === 'broken-promise')) {
        victim.grudges.push({
          id: nextId('gr'), week: state.week, type: 'broken-promise', targetId: null,
          data: { aggressorId: opportunity.aggressorId },
        });
      }
      state.journal.push(createEntry({
        week: state.week, at: 0,
        type: opportunity.promised ? 'promise-broken' : 'opportunity-cold',
        data: { victimId: opportunity.victimId, aggressorId: opportunity.aggressorId },
      }));
    }
  }
  state.opportunities = kept;
}
