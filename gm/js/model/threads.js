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

// What each kind of event does to the two things a rivalry is made of.
//
// `heat` is how invested the crowd is. `hatred` is what the two of them
// actually feel. They are deliberately not the same number, and the gap
// between them is the whole point of the system: a pair can sell out a
// building without disliking each other, and a pair can genuinely hate each
// other over something that happened in a corridor nobody filmed.
//
// The rule that makes it fall out on its own: **heat only comes from what went
// out on television.** A backstage argument is worth hatred and almost no heat,
// which is what gives the GM a reason to put a corridor grudge on camera.
const WEIGHT = {
  //                     heat  hatred
  match:                 [1,   0],   // a match is a match; nobody takes it personally
  'stare-down':          [2,   1],
  'handshake-refused':   [2,   2],
  handshake:             [-2, -3],   // they are fine, which quietens both
  'cheap-shot':          [3,   3],
  argument:              [1,   2],   // backstage: they felt it, the crowd did not
  'tag-dispute':         [1,   3],
  'faction-dispute':     [1,   3],
  attack:                [5,   4],
  brawl:                 [5,   4],
  ambush:                [4,   5],   // from behind is worth more to them than to the crowd
  'submission-held':     [4,   5],
  'faction-beatdown':    [6,   5],
  abandoned:             [3,   7],   // the deepest one, and the quietest
  save:                  [-3, -4],   // standing beside somebody is a story going the other way
  'broke-it-up':         [-1, -1],
  booked:                [3,   0],   // announcing it is fan interest and nothing else
  ruling:                [0,   1],
  // Tier 5's own kinds.
  promo:                 [4,   1],   // scaled by intensity and by what was said
  betrayal:              [5,   8],
  'title-change':        [5,   3],
  interference:          [4,   5],
  injury:                [3,   6],
};

// Crowds move on; people do not. Heat is read against a six-week half-life and
// hatred against twenty, so a thread can go quiet as a story while the two of
// them are still not speaking — which is a real state a locker room gets into
// and one the old single number could not express.
const HEAT_HALFLIFE = 6;
const HATRED_HALFLIFE = 20;

function fade(weeksAgo, halflife) {
  return 0.5 ** (Math.max(0, weeksAgo) / halflife);
}

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

// Everything a thread has accumulated, net and faded. Handshakes and saves
// subtract, which is what lets a pair stop being a feud without anything
// deleting them.
//
// `week` is the current week. Without it both readings fall back to unfaded
// sums, which is what every caller written before Tier 5 expects.
export function readingOf(thread, week = null) {
  let heat = 0;
  let hatred = 0;
  for (const event of thread.events) {
    const pair = WEIGHT[event.type];
    if (!pair) continue;
    const ago = week === null ? 0 : week - event.week;
    heat += pair[0] * (week === null ? 1 : fade(ago, HEAT_HALFLIFE));
    hatred += pair[1] * (week === null ? 1 : fade(ago, HATRED_HALFLIFE));
  }
  return { heat: Math.round(heat), hatred: Math.round(hatred) };
}

export function heatOf(thread, week = null) {
  return readingOf(thread, week).heat;
}

export function hatredOf(thread, week = null) {
  return readingOf(thread, week).hatred;
}

// A thread stays live while either half of it is still warm. A pair who have
// stopped being a draw but have not stopped hating each other are still a live
// thread — that is exactly the case the second axis exists to hold.
export function isLive(state, thread) {
  if (state.week - thread.lastWeek > COLD_AFTER) return false;
  const read = readingOf(thread, state.week);
  return read.heat > 0 || read.hatred > 0;
}

// The sharpest thing in it, which is what the title should be about.
export function peakOf(thread) {
  let best = null;
  for (const event of thread.events) {
    const pair = WEIGHT[event.type];
    if (!pair) continue;
    const weight = pair[0] + pair[1];
    if (weight <= 0) continue;
    const bestWeight = best ? (WEIGHT[best.type][0] + WEIGHT[best.type][1]) : 0;
    if (!best || weight > bestWeight) best = event;
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
      ...readingOf(thread, state.week),
      peak: peakOf(thread),
      weeks: state.week - thread.startedWeek + 1,
    }))
    // Sorted by what the crowd cares about, because this list is what the game
    // tells the player is worth booking. Bad blood nobody is watching turns up
    // on the wrestlers' own cards instead.
    .sort((x, y) => (y.heat + y.hatred * 0.4) - (x.heat + x.hatred * 0.4))
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

export { FEUD_AT, COLD_AFTER, WEIGHT, HEAT_HALFLIFE, HATRED_HALFLIFE };
