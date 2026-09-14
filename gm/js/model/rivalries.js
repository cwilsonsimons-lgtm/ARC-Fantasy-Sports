// What a rivalry is, read off what has happened.
//
// Nothing in here is stored. A rivalry is two numbers and a list of things a
// wrestler could say, all derived from the thread's own events and from the
// state of the two people in it — the same rule the rest of the game follows,
// where a reading is composed at the moment it is asked for and never frozen.
//
// The two numbers are the tier:
//
//   heat     how invested the crowd is
//   hatred   what the two of them actually feel
//
// They move apart on purpose. A pair can draw money without a cross word
// between them, and a pair can be genuinely unable to be in a room together
// over something that happened in a corridor nobody filmed. Those are different
// problems and the GM should be able to see which one they have.
import { byId, nameOf } from './wrestlers.js';
import { readingOf, threadBetween, isLive } from './threads.js';
import { relationship, rapport } from './relationships.js';
import { AMMO, ammoSpec } from '../data/promos.js';
import { lean } from './traits.js';

const HOT_AT = 14;      // the crowd is in
const BITTER_AT = 12;   // they mean it

// The four corners, named. The point of naming them is that three of the four
// are things a GM has to handle differently, and the old single number could
// only tell you about one of them.
export const QUADRANTS = {
  feud: {
    id: 'feud', label: 'A feud', tone: 'bad',
    note: 'The crowd is in and so are they. This is the one you build to.',
  },
  draw: {
    id: 'draw', label: 'A draw', tone: 'good',
    note: 'Good business and no bad blood. They will work it all year if you let them.',
  },
  blood: {
    id: 'blood', label: 'Bad blood', tone: 'warn',
    note: 'Real, and nobody is paying to see it. Put it on television or settle it.',
  },
  quiet: {
    id: 'quiet', label: 'Something and nothing', tone: 'plain',
    note: 'Two names who have crossed paths. Not a story yet.',
  },
};

export function quadrantOf(reading) {
  const hot = reading.heat >= HOT_AT;
  const bitter = reading.hatred >= BITTER_AT;
  if (hot && bitter) return QUADRANTS.feud;
  if (hot) return QUADRANTS.draw;
  if (bitter) return QUADRANTS.blood;
  return QUADRANTS.quiet;
}

// The whole reading on one pair, which is what every screen asks for.
export function rivalry(state, aId, bId) {
  const thread = threadBetween(state, aId, bId);
  if (!thread) return null;
  const reading = readingOf(thread, state.week);
  return {
    thread,
    ...reading,
    quadrant: quadrantOf(reading),
    live: isLive(state, thread),
    weeks: state.week - thread.startedWeek + 1,
    events: thread.events.length,
  };
}

// ---------------------------------------------------------------- the material

// Everything one wrestler could bring up about another, given what has actually
// happened. Ordered gentlest first, because that is the order a GM reads a list
// of things they are deciding whether to allow.
//
// `speaker` is doing the talking; `target` is the one it lands on.
export function ammoFor(state, speakerId, targetId) {
  const speaker = byId(state.wrestlers, speakerId);
  const target = byId(state.wrestlers, targetId);
  if (!speaker || !target) return [];

  const thread = threadBetween(state, speakerId, targetId);
  const events = (thread && thread.events) || [];
  const found = [];
  const add = (kind, detail, week) => {
    const spec = ammoSpec(kind);
    if (!spec) return;
    if (found.some(item => item.kind === kind)) return; // one of each, the sharpest
    found.push({ kind, label: spec.label, detail, week: week || null, ...spec });
  };

  // A one-sided record is material before anything dramatic has happened, which
  // is what gives a brand-new rivalry something to say.
  const rel = relationship(speaker, targetId);
  if (rel && (rel.matches || 0) >= 2) {
    add('record', `${rel.matches} meetings between them`, null);
  }

  for (const event of [...events].reverse()) {
    if (event.type === 'match') add('loss', 'a match they had', event.week);
    if (event.type === 'title-change') add('title-failure', 'a belt that changed hands', event.week);
    if (event.type === 'cheap-shot' || event.type === 'submission-held') {
      add('embarrassment', 'the way it ended', event.week);
    }
    if (event.type === 'injury') add('injury', 'the night they got hurt', event.week);
    if (event.type === 'betrayal') add('betrayal', 'what they did', event.week);
    if (event.type === 'abandoned') add('abandoned', 'the night they walked away', event.week);
  }

  // Things that are true about the target rather than about the pair. This is
  // the material that makes a promo feel like it knows them.
  if ((target.grudges || []).some(g => g.type === 'broken-promise')) {
    add('promise', 'something the office said and did not do', null);
  }

  const ally = closestTo(state, target, speakerId);
  if (ally) add('ally', nameOf(state.wrestlers, ally), null);

  const losses = target.record ? target.record.losses : 0;
  const wins = target.record ? target.record.wins : 0;
  if (losses >= 4 && losses > wins) add('years', 'a record that speaks for itself', null);

  return found.sort((a, b) => (a.heat + a.hatred) - (b.heat + b.hatred));
}

// Somebody the target would not want brought into it — their closest tie who is
// not the person talking.
function closestTo(state, target, exceptId) {
  let best = null;
  let bestScore = 0;
  for (const [otherId, rel] of Object.entries(target.relationships || {})) {
    if (otherId === exceptId) continue;
    if (!byId(state.wrestlers, otherId)) continue;
    const score = (rel.tie ? 12 : 0) + rapport(rel);
    if (score > bestScore) { bestScore = score; best = otherId; }
  }
  return bestScore >= 10 ? best : null;
}

// ---------------------------------------------------------------- anticipation

// How much the building wants to see a match, before it happens.
//
// Deliberately composed of things the GM did rather than things the wrestlers
// are. Ability is not in here at all — a great match between two people nobody
// has a reason to watch is still a match nobody is waiting for, and that is the
// distinction the tier exists to make.
const ANTICIPATION = [
  [62, 'The one they came for', 'good'],
  [44, 'A real main event', 'good'],
  [28, 'People want to see this', 'fine'],
  [14, 'There is something here', 'plain'],
  [0, 'Nobody is waiting for this', 'warn'],
];

export function anticipationFor(state, item) {
  const sides = sidesOfItem(item);
  if (sides.length < 2) return null;

  let heat = 0;
  let hatred = 0;
  let pairs = 0;
  for (let a = 0; a < sides.length; a += 1) {
    for (let b = a + 1; b < sides.length; b += 1) {
      for (const x of sides[a]) {
        for (const y of sides[b]) {
          const read = rivalry(state, x, y);
          pairs += 1;
          if (!read) continue;
          heat += read.heat;
          hatred += read.hatred;
        }
      }
    }
  }
  // Averaged across the pairings so a battle royal is not automatically the
  // biggest match on the card by virtue of having the most pairs in it.
  const story = pairs ? (heat + hatred * 0.5) / Math.sqrt(pairs) : 0;

  // Stakes: a belt on the line is the clearest reason to care, and the game
  // already knows whether there is one.
  const stakes = item.titleId ? 16 : 0;

  // Promo build: what has been said about it in the last few weeks.
  const build = promoBuild(state, sides);

  // Who is in it. The crowd cares more about the top of the card, which is the
  // one place a wrestler's standing rather than the GM's booking counts.
  const standing = standingOf(state, sides);

  const total = Math.round(story + stakes + build + standing);
  const [, label, tone] = ANTICIPATION.find(([floor]) => total >= floor) || ANTICIPATION[ANTICIPATION.length - 1];
  return { value: total, label, tone, story: Math.round(story), stakes, build, standing };
}

const PROMO_WINDOW = 4;

function promoBuild(state, sides) {
  let total = 0;
  for (let a = 0; a < sides.length; a += 1) {
    for (let b = a + 1; b < sides.length; b += 1) {
      for (const x of sides[a]) {
        for (const y of sides[b]) {
          const thread = threadBetween(state, x, y);
          if (!thread) continue;
          for (const event of thread.events) {
            if (event.type !== 'promo') continue;
            if (state.week - event.week > PROMO_WINDOW) continue;
            total += 5 - (state.week - event.week);
          }
        }
      }
    }
  }
  return Math.min(24, total);
}

const ROLE_DRAW = { 'Main event': 9, 'Upper card': 6, Midcard: 3, Opener: 1, Prospect: 1 };

function standingOf(state, sides) {
  let best = 0;
  for (const side of sides) {
    for (const id of side) {
      const w = byId(state.wrestlers, id);
      if (w) best = Math.max(best, ROLE_DRAW[w.role] || 2);
    }
  }
  return best;
}

function sidesOfItem(item) {
  if (!item || item.type !== 'match') return [];
  const ids = item.participants || [];
  const sides = [];
  let at = 0;
  for (const size of item.sides || [1, 1]) {
    sides.push(ids.slice(at, at + size).filter(Boolean));
    at += size;
  }
  return sides.filter(side => side.length);
}

// ---------------------------------------------------------------- the match

// What the match was, once it has happened.
//
// Seven ingredients, and only two of them are about how good the wrestlers are.
// The rest is what the GM built around them, which is the argument the whole
// system is making: a card of technically excellent matches between strangers
// is a worse show than a card of ordinary matches people are invested in.
const QUALITY = [
  [76, 'A classic', 'good'],
  [60, 'A very good match', 'good'],
  [44, 'A good match', 'fine'],
  [28, 'Perfectly fine', 'plain'],
  [14, 'Flat', 'warn'],
  [0, 'It died out there', 'bad'],
];

export function matchQuality(state, item, anticipation) {
  const sides = sidesOfItem(item);
  if (sides.length < 2) return null;
  const ids = sides.flat();
  const people = ids.map(id => byId(state.wrestlers, id)).filter(Boolean);
  if (!people.length) return null;

  // What they can do. The average keeps one excellent worker from carrying a
  // match on paper, and the best of them still counts for something.
  const ring = people.reduce((n, w) => n + (w.stats.inRing || 50), 0) / people.length;
  const top = people.reduce((n, w) => Math.max(n, w.stats.inRing || 50), 0);
  const wrestling = (ring * 0.7 + top * 0.3) * 0.42;

  // Chemistry: people who have worked together are better at it, and people
  // who cannot stand each other are worse at the parts that need trust.
  let chemistry = 0;
  let pairs = 0;
  for (let a = 0; a < sides.length; a += 1) {
    for (let b = a + 1; b < sides.length; b += 1) {
      for (const x of sides[a]) {
        for (const y of sides[b]) {
          const w = byId(state.wrestlers, x);
          if (!w) continue;
          const rel = relationship(w, y);
          chemistry += Math.min(10, rapport(rel) * 0.6);
          pairs += 1;
        }
      }
    }
  }
  chemistry = pairs ? chemistry / pairs : 0;

  // And the crowd. Anticipation is most of what separates a good match from a
  // match people will remember, which is the point.
  const crowd = anticipation ? Math.min(30, anticipation.value * 0.4) : 0;

  // Time. A finish crammed into four minutes is a finish nobody felt.
  const minutes = item.plannedMinutes || 0;
  const room = minutes >= 12 ? 6 : minutes >= 8 ? 3 : minutes >= 5 ? 0 : -6;

  const total = Math.round(wrestling + chemistry + crowd + room);
  const [, label, tone] = QUALITY.find(([floor]) => total >= floor) || QUALITY[QUALITY.length - 1];
  return {
    value: total, label, tone,
    wrestling: Math.round(wrestling),
    chemistry: Math.round(chemistry),
    crowd: Math.round(crowd),
    room,
  };
}

// How likely a promo is to stop being a promo. The intensity sets the floor and
// the two of them decide the rest — a short-tempered pair carry a hostile
// segment much closer to the edge than two professionals do.
export function fightChance(state, base, speakerId, targetId) {
  const speaker = byId(state.wrestlers, speakerId);
  const target = byId(state.wrestlers, targetId);
  if (!speaker || !target) return base;

  let chance = base;
  for (const person of [speaker, target]) {
    chance += lean(person, 'aggression') * 0.10;
    chance -= lean(person, 'patience') * 0.07;
    chance -= lean(person, 'professionalism') * 0.08;
  }
  return Math.max(0, Math.min(0.95, chance));
}

export { HOT_AT, BITTER_AT };
