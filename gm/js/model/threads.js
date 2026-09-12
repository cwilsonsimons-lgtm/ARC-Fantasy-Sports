// The stories the game noticed.
//
// Everything in the tiers underneath this produces events between two people: a
// match, an attack, a save, somebody standing still when they were needed. On
// their own they are a feed. Read together they are a feud — and nobody wrote
// it, which is the point.
//
// A thread is just a pair and their running record. It does not steer anything;
// it is a *reading* of what has already happened, kept so the aftermath can say
// "this is building" without the player having to hold forty journal lines in
// their head. Titles are composed at render time from the events, as all prose
// in this prototype is.
import { byId } from './wrestlers.js';
import { nextId } from '../ids.js';

// Kept high enough that the count still tells threads apart. At twelve, every
// pair who had met a few times sat pinned against the ceiling and the reading
// said "a dozen things" about all of them — the same saturation that made the
// memory cap stop measuring anything.
const KEEP_EVENTS = 24;
const COLD_AFTER = 8;    // weeks with nothing before it stops being live
const FEUD_AT = 3;       // events before it is worth telling the player about

// How much each kind of event says about two people. A match between them is
// ordinary; one of them standing there while the other took a beating is not.
const WEIGHT = {
  match: 1,
  'stare-down': 2,
  'handshake-refused': 2,
  handshake: -2,          // they are fine, which quietens a thread rather than feeding it
  'cheap-shot': 3,
  argument: 2,
  'tag-dispute': 3,
  'faction-dispute': 3,
  attack: 5,
  brawl: 5,
  ambush: 5,
  'submission-held': 5,
  'faction-beatdown': 6,
  abandoned: 6,           // the deepest one, and the quietest
  save: -3,               // standing beside somebody is a story going the other way
  'broke-it-up': -1,
  booked: 3,
  ruling: 1,
};

function key(aId, bId) {
  return aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
}

export function threadBetween(state, aId, bId) {
  if (!aId || !bId || aId === bId) return null;
  return (state.threads || []).find(t => key(t.a, t.b) === key(aId, bId)) || null;
}

// Records that something happened between two people. Everything that names a
// pair calls this, which is why the reading is complete without anything having
// to remember to keep it up to date.
export function noteThread(state, aId, bId, type, at = 0) {
  if (!aId || !bId || aId === bId) return null;
  if (aId === 'gm' || bId === 'gm') return null; // you are not one half of a feud
  if (WEIGHT[type] === undefined) return null;

  state.threads = state.threads || [];
  let thread = threadBetween(state, aId, bId);
  if (!thread) {
    thread = {
      id: nextId('th'),
      a: aId, b: bId,
      startedWeek: state.week,
      lastWeek: state.week,
      events: [],
    };
    state.threads.push(thread);
  }

  thread.lastWeek = state.week;
  thread.events.push({ week: state.week, type, at });
  if (thread.events.length > KEEP_EVENTS) {
    thread.events.splice(0, thread.events.length - KEEP_EVENTS);
  }
  return thread;
}

// Everything a thread has accumulated, net. Handshakes and saves subtract,
// which is what lets a pair stop being a feud without anything deleting them.
export function heatOf(thread) {
  return thread.events.reduce((sum, event) => sum + (WEIGHT[event.type] || 0), 0);
}

export function isLive(state, thread) {
  return state.week - thread.lastWeek <= COLD_AFTER && heatOf(thread) > 0;
}

// The sharpest thing in it, which is what the title should be about.
export function peakOf(thread) {
  let best = null;
  for (const event of thread.events) {
    const weight = WEIGHT[event.type] || 0;
    if (weight <= 0) continue;
    if (!best || weight > (WEIGHT[best.type] || 0)) best = event;
  }
  return best;
}

// What the game would tell the player is building, hottest first. Only pairs
// with a real record — two people who have had one match are not a story.
export function liveThreads(state, limit = 5) {
  return (state.threads || [])
    .filter(thread => thread.events.length >= FEUD_AT && isLive(state, thread))
    .filter(thread => byId(state.wrestlers, thread.a) && byId(state.wrestlers, thread.b))
    .map(thread => ({
      thread,
      heat: heatOf(thread),
      peak: peakOf(thread),
      weeks: state.week - thread.startedWeek + 1,
    }))
    .sort((x, y) => y.heat - x.heat)
    .slice(0, limit);
}

// Whatever this one wrestler has going, for their card.
export function threadsFor(state, wrestlerId, limit = 3) {
  return liveThreads(state, 99)
    .filter(entry => entry.thread.a === wrestlerId || entry.thread.b === wrestlerId)
    .slice(0, limit);
}

// Called when the week turns. Nothing is deleted while it is still warm; a pair
// who have stopped having a problem simply drop off the reading, and the record
// stays in case it starts again.
export function forgetColdThreads(state) {
  const before = (state.threads || []).length;
  state.threads = (state.threads || []).filter(thread =>
    state.week - thread.lastWeek <= COLD_AFTER * 3);
  return before - state.threads.length;
}

export { FEUD_AT, COLD_AFTER };
