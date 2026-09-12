// The night as the GM actually experiences it: standing somewhere, with a
// finite number of minutes, while things happen in rooms they are not in.
//
// Three ideas hold this tier up.
//
// **The clock is the match.** However long the item on air runs is however long
// the GM has backstage before the next one starts. A card of short matches
// leaves you no room to manage anybody; a twenty-minute main event buys you the
// walk to the car park and back. Booking and presence are the same decision
// seen from two ends, which is the whole reason the window is worth earning.
//
// **Thinking is free, acting costs clock.** Reading the room, looking at who is
// where, weighing it up — none of that moves the clock. Walking does. Talking
// does. So the cost is always of the thing you chose to do, never of the time
// you took to choose it.
//
// **Things happen whether you are there or not.** An incident in a room you are
// not standing in still resolves: the locker room reacts on its own, memories
// file, grudges form. You simply do not get to rule on it — and not having
// ruled on it is itself something the room notices. That is the difference
// between a game about presence and a game about menus.
import { byId } from './wrestlers.js';
import { trait, lean } from './traits.js';
import { LOCATIONS, location, walkMinutes, hops, routesFrom } from '../data/locations.js';
import { currentItem, upcomingItems, elapsedMinutes } from './broadcast.js';

export const START_LOCATION = 'gorilla';
export const TALK_MINUTES = 2;
export const SECURITY_STAFF = 2;

// ---------------------------------------------------------------- the clock

export function createClock(minutes) {
  return { segmentMinutes: Math.max(0, Math.round(minutes)), spent: 0 };
}

export function minutesLeft(state) {
  const clock = state.clock;
  if (!clock) return 0;
  return Math.max(0, clock.segmentMinutes - clock.spent);
}

export function canSpend(state, minutes) {
  return minutesLeft(state) >= minutes;
}

// Returns the minutes actually spent, which is what any roll for "did something
// happen while you were doing that" is scaled against.
export function spend(state, minutes) {
  if (!state.clock) return 0;
  const taken = Math.min(minutesLeft(state), Math.max(0, Math.round(minutes)));
  state.clock.spent += taken;
  return taken;
}

// The show-clock minute an action lands on, for the journal.
export function nowAt(state) {
  return elapsedMinutes(state.broadcast) + (state.clock ? state.clock.spent : 0);
}

// ---------------------------------------------------------------- whereabouts

// Anyone in the next item is already at the curtain; anyone in the one on air is
// either out there or coming back through it. Everything else is a read on the
// person: the ones who want to be seen stand where they will be, the ones
// sulking are as far from you as the building allows.
function preferredRoom(state, wrestler, roll) {
  if (wrestler.status === 'Injured') return roll() < 0.55 ? 'medical' : 'locker';

  const ambition = lean(wrestler, 'ambition');
  const ego = lean(wrestler, 'ego');
  const selfish = lean(wrestler, 'selfishness');
  const mood = (wrestler.morale - 50) / 50;

  const weights = [
    ['locker', 3],
    ['catering', 1.6 + (mood < -0.2 ? 0.8 : 0)],
    ['hallways', 1.2 + ambition * 0.8],
    ['gorilla', 0.8 + ambition * 1.1 + ego * 0.6],
    ['interview', 0.5 + wrestler.stats.charisma / 90],
    ['production', 0.25],
    ['medical', 0.3],
    ['office', 0.2 + Math.max(0, -mood) * 0.5],
    ['security', 0.15],
    // Somebody unhappy and out for themselves sits in their car. It is the
    // furthest room from you, which is the point of it.
    ['parking', 0.15 + Math.max(0, -mood) * (0.8 + selfish * 0.6)],
  ];

  const total = weights.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
  let pick = roll() * total;
  for (const [id, w] of weights) {
    pick -= Math.max(0, w);
    if (pick <= 0) return id;
  }
  return 'locker';
}

// Friends stand with friends. Applied after the individual read so a tag team
// is in the same room without either of them having chosen it separately.
function pullTogether(state, whereabouts, roll) {
  for (const wrestler of state.wrestlers) {
    if (!whereabouts[wrestler.id]) continue;
    for (const [otherId, rel] of Object.entries(wrestler.relationships || {})) {
      if (!rel.tie || rel.tie === 'bad-blood') continue;
      if (!whereabouts[otherId]) continue;
      if (roll() < 0.6) whereabouts[wrestler.id] = whereabouts[otherId];
      break;
    }
  }
}

function atCurtain(state) {
  const ids = new Set();
  const current = currentItem(state.show, state.broadcast);
  if (current) current.participants.forEach(id => ids.add(id));
  const next = upcomingItems(state.show, state.broadcast)[0];
  if (next) next.participants.forEach(id => ids.add(id));
  return ids;
}

// Rebuilt from scratch when the show goes on the air.
export function placeEveryone(state, roll) {
  const whereabouts = {};
  const curtain = atCurtain(state);

  for (const wrestler of state.wrestlers) {
    // Suspended and unavailable people are not in the building at all, which is
    // the part of a suspension that actually costs you something.
    if (wrestler.status === 'Unavailable') continue;
    whereabouts[wrestler.id] = curtain.has(wrestler.id)
      ? 'gorilla'
      : preferredRoom(state, wrestler, roll);
  }

  pullTogether(state, whereabouts, roll);
  state.whereabouts = whereabouts;
  return whereabouts;
}

// The building does not hold still between segments. About a third of the room
// moves each time, plus anybody the card has just called for — otherwise the
// map is a photograph and going back to a room always finds the same people.
export function shuffleRooms(state, roll) {
  const whereabouts = state.whereabouts || {};
  const curtain = atCurtain(state);

  for (const wrestler of state.wrestlers) {
    if (wrestler.status === 'Unavailable') { delete whereabouts[wrestler.id]; continue; }
    if (curtain.has(wrestler.id)) { whereabouts[wrestler.id] = 'gorilla'; continue; }
    if (!whereabouts[wrestler.id]) { whereabouts[wrestler.id] = preferredRoom(state, wrestler, roll); continue; }
    if (roll() < 0.34) whereabouts[wrestler.id] = preferredRoom(state, wrestler, roll);
  }

  state.whereabouts = whereabouts;
  return whereabouts;
}

export function roomOf(state, wrestlerId) {
  return (state.whereabouts || {})[wrestlerId] || null;
}

export function peopleIn(state, locationId) {
  return state.wrestlers.filter(w => roomOf(state, w.id) === locationId);
}

export function inTheBuilding(state) {
  return state.wrestlers.filter(w => roomOf(state, w.id));
}

// ---------------------------------------------------------------- the GM

export function whereYouAre(state) {
  return location(state.location || START_LOCATION);
}

export function canWalkTo(state) {
  return routesFrom(state.location || START_LOCATION)
    .map(route => ({ ...route, affordable: canSpend(state, route.minutes) }));
}

// Whether the GM standing here would see a thing happening there.
//
// Three answers, and the middle one is the interesting one: from the next room
// you know something is going on and who is in it, but not what it is, and
// going to look costs you the walk — by which time it may be over.
export function visibility(state, locationId, carry = 1) {
  const here = state.location || START_LOCATION;
  const distance = hops(here, locationId);
  if (distance === 0) return 'witnessed';
  if (distance <= carry) return 'heard';
  return 'missed';
}

// ---------------------------------------------------------------- authority

const AUTHORITY_FLOOR = 10; // until you have made a few calls, nobody has a read

// Does what you say carry? Built from the pattern of your rulings rather than a
// stat you spend: following through raises it, and the two ways of avoiding a
// decision — giving somebody what they want, and not being in the room — are
// what take it down.
//
// Expressed as a share of the calls you have made rather than a running sum, so
// it converges on how you tend to be read instead of climbing forever.
export function authorityValue(state) {
  const r = state.gmRecord || {};
  const good = (r.fair || 0) * 3 + (r.harsh || 0) * 2;
  // Ignoring something is a choice the room watched you make. Not being in the
  // room is a different failure and a much more ordinary one — there are ten
  // rooms and one of you — so it costs a fraction as much per event, and mostly
  // matters by piling up.
  const bad = (r.weak || 0) * 2 + (r.ignored || 0) * 2
    + (r.gaveIn || 0) * 4 + (r.delayed || 0) * 1.5 + (r.missed || 0) * 0.8;
  const calls = (r.fair || 0) + (r.harsh || 0) + (r.weak || 0) + (r.ignored || 0)
    + (r.gaveIn || 0) + (r.delayed || 0) + (r.missed || 0);

  const standing = (good - bad) / Math.max(AUTHORITY_FLOOR, calls) / 3;
  return Math.max(0, Math.min(100, Math.round(50 + standing * 50)));
}

const AUTHORITY_BANDS = [
  [76, 'Your word is the end of it', 'good'],
  [60, 'People do what you say', 'fine'],
  [42, 'You are listened to, mostly', 'plain'],
  [26, 'Your word is negotiable', 'warn'],
  [0, 'Nobody here is afraid of you', 'bad'],
];

export function authority(state) {
  const value = authorityValue(state);
  const [, phrase, tone] = AUTHORITY_BANDS.find(([floor]) => value >= floor);
  return { value, phrase, tone };
}

// Low authority is not a penalty applied to a number — it is a reason things
// happen. This is the multiplier on how often the building gives you trouble.
export function troubleFactor(state) {
  return 1.45 - (authorityValue(state) / 100) * 0.9; // 1.45x down to 0.55x
}

// ---------------------------------------------------------------- security

export function securityLeft(state) {
  const used = state.security ? state.security.used : 0;
  return Math.max(0, SECURITY_STAFF - used);
}

export function useSecurity(state) {
  state.security = state.security || { used: 0 };
  state.security.used += 1;
}

export function resetSecurity(state) {
  state.security = { used: 0 };
}

export { LOCATIONS, location, walkMinutes, hops, routesFrom };
