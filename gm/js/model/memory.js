// What a wrestler remembers, and why they feel the way they do.
//
// Morale used to be a bare number that six different files nudged without
// leaving a trace, so "why is this one furious" had no answer. Now morale is
// not stored at all in the sense that matters — it is *derived*:
//
//   morale = their natural level + everything they currently remember
//
// which means the card's account of a mood is the mood, not a commentary on it.
// It also fixes the thing a running total gets wrong. Memories fade, and if the
// number they moved were kept, a wrestler would stay elated about a title they
// won two years ago. Deriving it means people drift back toward who they are.
//
// How fast they drift depends on the person: somebody vindictive holds a slight
// long after a forgiving one has stopped thinking about it. `wrestler.morale`
// is still written on the object, because everything in the game reads it and
// the save has to serialise — but it is a cached answer, never a source.
//
// Grudges are the other half. A memory is a feeling; a grudge is a position,
// and it outlives the feeling that caused it — but not forever, and how long is
// again a question about the person.
import { byId } from './wrestlers.js';
import { lean } from './traits.js';
import { nextId } from '../ids.js';

export const SOURCES = [
  { key: 'opportunity', label: 'Opportunities' },
  { key: 'airtime', label: 'Television time' },
  { key: 'result', label: 'Wins and losses' },
  { key: 'title', label: 'Championships' },
  { key: 'gm', label: 'How you have treated them' },
  { key: 'ally', label: 'How you have treated their friends' },
  { key: 'peer', label: 'The locker room' },
];

const KEEP = 60;         // memories per wrestler before the oldest are dropped
const FADE_FLOOR = 0.08; // below this a memory has stopped mattering
const DEFAULT_BASELINE = 55;

// How long a position is held, in weeks, before the person stops taking it.
// Scaled by how vindictive they are — the same slight is a fortnight to one
// wrestler and most of a year to another.
const GRUDGE_LIFE = {
  attacked: 10,
  abandoned: 16,      // being left there is the one nobody gets over quickly
  punished: 9,
  'broken-promise': 12,
  overlooked: 8,
  'hated-match': 30,  // not a grievance so much as a standing objection
};
const DEFAULT_GRUDGE_LIFE = 10;

export function sourceLabel(key) {
  const source = SOURCES.find(s => s.key === key);
  return source ? source.label : key;
}

// Who they are when nothing has happened to them. Everything else is measured
// from here, and everything else eventually fades back to it.
export function baselineOf(wrestler) {
  return Number.isFinite(wrestler.baseline) ? wrestler.baseline : DEFAULT_BASELINE;
}

export function moraleOf(wrestler) {
  let total = baselineOf(wrestler);
  for (const memory of wrestler.memories || []) total += memory.weight * memory.fade;
  return Math.max(0, Math.min(100, Math.round(total)));
}

// `wrestler.morale` is a cache of the line above. Recomputed wherever memory
// changes, so nothing in the game has to know it is derived.
export function refreshMorale(wrestler) {
  wrestler.morale = moraleOf(wrestler);
  return wrestler.morale;
}

// The one place a feeling is recorded. `weight` is what it does to the mood;
// the memory keeps it so the card can say what the mood is made of.
export function remember(state, wrestlerId, { source, weight, targetId = null, detail = null }) {
  const wrestler = typeof wrestlerId === 'object' ? wrestlerId : byId(state.wrestlers, wrestlerId);
  if (!wrestler) return null;

  const delta = Math.round(weight);
  if (!delta) return null;

  wrestler.memories = wrestler.memories || [];
  const memory = {
    id: nextId('mem'),
    week: state.week,
    source,
    weight: delta,
    targetId,
    detail,
    fade: 1,
  };
  wrestler.memories.push(memory);
  if (wrestler.memories.length > KEEP) wrestler.memories.splice(0, wrestler.memories.length - KEEP);
  refreshMorale(wrestler);
  return memory;
}

// Called when the week turns. Good news fades at a steady rate; grievances fade
// at a rate the person decides — and as they fade, the mood returns to whoever
// the wrestler was before any of it happened.
export function fadeMemories(state) {
  for (const wrestler of state.wrestlers) {
    if (!wrestler.memories) continue;

    // 0.72 for somebody who lets things go, 0.96 for somebody who does not.
    const grip = 0.84 + lean(wrestler, 'vindictiveness') * 0.12;
    const kept = [];
    for (const memory of wrestler.memories) {
      memory.fade *= memory.weight < 0 ? grip : 0.8;
      if (memory.fade >= FADE_FLOOR) kept.push(memory);
    }
    wrestler.memories = kept;
    refreshMorale(wrestler);
  }
}

// And positions expire too, or a roster played for a year is one where everyone
// hates everyone. A grudge that is still being fed — the same person keeps
// doing the same thing — is refreshed when it is re-filed, so only the ones
// nobody has topped up go quiet.
export function coolGrudges(state) {
  for (const wrestler of state.wrestlers) {
    if (!Array.isArray(wrestler.grudges)) continue;
    const hold = 1 + lean(wrestler, 'vindictiveness') * 0.6; // 0.4x .. 1.6x
    wrestler.grudges = wrestler.grudges.filter(grudge => {
      const life = (GRUDGE_LIFE[grudge.type] || DEFAULT_GRUDGE_LIFE) * hold;
      return state.week - (grudge.week || 0) < life;
    });
  }
}

// What the current mood is actually made of, biggest contribution first.
export function moraleSources(wrestler) {
  const totals = new Map();
  for (const memory of wrestler.memories || []) {
    const current = totals.get(memory.source) || 0;
    totals.set(memory.source, current + memory.weight * memory.fade);
  }

  return SOURCES
    .map(source => ({ key: source.key, label: source.label, total: totals.get(source.key) || 0 }))
    .filter(entry => Math.abs(entry.total) >= 1)
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

// The single sharpest thing on their mind, for a one-line read.
export function strongestFeeling(wrestler) {
  const sources = moraleSources(wrestler);
  return sources.length ? sources[0] : null;
}

// ---------- how they feel about you ----------

// The bands are not symmetric, because the feelings behind them are not. Good
// treatment fades faster than bad treatment does, so a wrestler who thinks well
// of you is carrying a smaller running total than one who does not — and the
// thresholds have to be read against that or nobody would ever reach the top
// band no matter how well they were treated.
const STANDINGS = [
  [18, 'trusts you', 'good'],
  [6, 'gives you the benefit of the doubt', 'fine'],
  [-8, 'is waiting to see', 'plain'],
  [-28, 'is wary of you', 'warn'],
  [-Infinity, 'has no time for you', 'bad'],
];

// How long a view of the office takes to change. Deliberately much slower than
// morale: a mood is about this week, but what somebody thinks of you is built
// over a season and does not reset because the last month was quiet. Using the
// memory's own fade here would mean nobody could ever think well of you, since
// good news fades in a fortnight by design.
const STANDING_HALFLIFE = 12;

// Built from what they remember of your decisions, softened or sharpened by how
// much they respect the office in the first place. `week` is the current week;
// without it this falls back to the memory's own decay, which reads colder.
export function gmStandingValue(wrestler, week = null) {
  let total = 0;
  for (const memory of wrestler.memories || []) {
    if (memory.source !== 'gm' && memory.source !== 'ally') continue;
    const decay = week === null
      ? memory.fade
      : 0.5 ** (Math.max(0, week - (memory.week || 0)) / STANDING_HALFLIFE);
    total += memory.weight * decay;
  }

  // Somebody who respects the office takes a hard call better; somebody who
  // does not takes it worse, and remembers it as yours.
  const respect = lean(wrestler, 'authority');
  if (total < 0) total *= 1 - respect * 0.4;

  // A grudge against management is heavier than the memory that caused it.
  const managementGrudges = (wrestler.grudges || []).filter(g => g.targetId === null).length;
  return total - managementGrudges * 9;
}

export function gmStanding(wrestler, week = null) {
  const value = gmStandingValue(wrestler, week);
  const [, phrase, tone] = STANDINGS.find(([floor]) => value >= floor);
  return { value, phrase, tone };
}

// A wrestler's own memories of another wrestler, for the relationship read.
export function feelingToward(wrestler, otherId) {
  let total = 0;
  for (const memory of wrestler.memories || []) {
    if (memory.targetId !== otherId) continue;
    total += memory.weight * memory.fade;
  }
  return total;
}
